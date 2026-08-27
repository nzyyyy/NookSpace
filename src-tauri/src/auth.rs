#[cfg(target_os = "macos")]
pub fn authenticate() -> Result<bool, String> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{
        kLAErrorAppCancel, kLAErrorAuthenticationFailed, kLAErrorSystemCancel, kLAErrorUserCancel,
        kLAPolicyDeviceOwnerAuthentication, LAContext, LAPolicy,
    };
    use std::sync::mpsc;

    // SAFETY: LocalAuthentication owns the UI and invokes the sendable reply
    // block. The context and block stay alive until the callback completes.
    unsafe {
        let context = LAContext::new();
        let policy = LAPolicy(kLAPolicyDeviceOwnerAuthentication as _);
        context
            .canEvaluatePolicy_error(policy)
            .map_err(|error| error.localizedDescription().to_string())?;

        let reason = NSString::from_str("解锁受保护的内容");
        let (sender, receiver) = mpsc::channel();
        let reply = RcBlock::new(move |success: Bool, error: *mut NSError| {
            let result = if success.as_bool() {
                Ok(true)
            } else if let Some(error) = error.as_ref() {
                let code = error.code() as i32;
                if [
                    kLAErrorUserCancel,
                    kLAErrorSystemCancel,
                    kLAErrorAppCancel,
                    kLAErrorAuthenticationFailed,
                ]
                .contains(&code)
                {
                    Ok(false)
                } else {
                    Err(error.localizedDescription().to_string())
                }
            } else {
                Err("系统认证失败".to_string())
            };
            let _ = sender.send(result);
        });
        context.evaluatePolicy_localizedReason_reply(policy, &reason, &reply);
        receiver
            .recv()
            .map_err(|_| "系统认证未返回结果".to_string())?
    }
}

#[cfg(not(target_os = "macos"))]
pub fn authenticate() -> Result<bool, String> {
    Err("轻量锁仅支持 macOS".into())
}
