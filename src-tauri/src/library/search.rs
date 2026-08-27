use std::path::Path;

use rusqlite::params;

use crate::library::models::{IndexResult, SearchIndexStatus};
use crate::library::Library;

#[derive(Debug, Default, PartialEq)]
pub(super) struct ParsedQuery {
    pub text: Vec<String>,
    pub item_types: Vec<String>,
    pub tags: Vec<String>,
    pub collections: Vec<String>,
    pub dates: Vec<(char, String)>,
}

pub(super) fn parse_query(input: &str) -> ParsedQuery {
    let mut parsed = ParsedQuery::default();
    for token in split_query(input) {
        let Some((key, value)) = token.split_once(':') else {
            if !token.is_empty() {
                parsed.text.push(token);
            }
            continue;
        };
        match key.to_ascii_lowercase().as_str() {
            "type" if matches!(value, "note" | "file" | "link") => {
                parsed.item_types.push(value.to_string())
            }
            "tag" if !value.is_empty() => parsed.tags.push(value.to_string()),
            "collection" if !value.is_empty() => parsed.collections.push(value.to_string()),
            "date" => {
                let (op, date) = match value.as_bytes().first() {
                    Some(b'>') => ('>', &value[1..]),
                    Some(b'<') => ('<', &value[1..]),
                    _ => ('=', value),
                };
                if valid_date(date) {
                    parsed.dates.push((op, date.to_string()));
                } else {
                    parsed.text.push(token);
                }
            }
            _ => parsed.text.push(token),
        }
    }
    parsed
}

fn split_query(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quoted = false;
    for ch in input.chars() {
        match ch {
            '"' => quoted = !quoted,
            ch if ch.is_whitespace() && !quoted => {
                if !token.is_empty() {
                    tokens.push(std::mem::take(&mut token));
                }
            }
            _ => token.push(ch),
        }
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    tokens
}

fn valid_date(value: &str) -> bool {
    value.len() == 10
        && value.as_bytes()[4] == b'-'
        && value.as_bytes()[7] == b'-'
        && value
            .bytes()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
}

pub(super) fn fts_query(terms: &[String]) -> Option<String> {
    (!terms.is_empty() && terms.iter().all(|term| term.chars().count() >= 3)).then(|| {
        terms
            .iter()
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND ")
    })
}

pub(super) fn plain_snippet(sources: &[&str], terms: &[String]) -> Option<String> {
    for source in sources {
        let lower = source.to_lowercase();
        for term in terms {
            if let Some(index) = lower.find(&term.to_lowercase()) {
                let mut start = index.saturating_sub(60);
                while start > 0 && !source.is_char_boundary(start) {
                    start -= 1;
                }
                let mut end = (index + term.len() + 100).min(source.len());
                while end < source.len() && !source.is_char_boundary(end) {
                    end += 1;
                }
                return Some(format!(
                    "{}{}{}",
                    if start > 0 { "…" } else { "" },
                    source[start..end].replace('\n', " "),
                    if end < source.len() { "…" } else { "" }
                ));
            }
        }
    }
    None
}

impl Library {
    pub(crate) fn index_pdf_item(&self, id: &str, path: &Path) -> Result<bool, String> {
        {
            let conn = self.db.lock().unwrap();
            self.require_item_access(&conn, id)?;
        }
        let extracted = pdf_extract::extract_text(path);
        let (text, error) = match extracted {
            Ok(text) => (text, None),
            Err(error) => (String::new(), Some(error.to_string())),
        };
        let success = error.is_none();
        let conn = self.db.lock().unwrap();
        conn.execute(
            "UPDATE items SET extracted_text = ?1, extracted_at = datetime('now'), extraction_error = ?2 WHERE id = ?3 AND mime = 'application/pdf'",
            params![text, error, id],
        )
        .map_err(|error| error.to_string())?;
        Ok(success)
    }

    pub fn search_index_status(&self) -> Result<SearchIndexStatus, String> {
        let conn = self.db.lock().unwrap();
        let pending = conn
            .query_row(
                "SELECT COUNT(*) FROM items WHERE mime = 'application/pdf' AND extracted_at IS NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let failed = conn
            .query_row(
                "SELECT COUNT(*) FROM items WHERE mime = 'application/pdf' AND extraction_error IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        Ok(SearchIndexStatus { pending, failed })
    }

    pub fn index_pending_pdfs(&self, retry_failed: bool) -> Result<IndexResult, String> {
        let rows: Vec<(String, String)> = {
            let conn = self.db.lock().unwrap();
            let sql = if retry_failed {
                "SELECT id, stored_path FROM items WHERE mime = 'application/pdf' AND (extracted_at IS NULL OR extraction_error IS NOT NULL)"
            } else {
                "SELECT id, stored_path FROM items WHERE mime = 'application/pdf' AND extracted_at IS NULL"
            };
            let mut stmt = conn.prepare(sql).map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| error.to_string())?;
            let rows = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?;
            let ids = rows.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
            self.require_items_access(&conn, &ids)?;
            rows
        };

        let mut result = IndexResult {
            indexed: 0,
            failed: 0,
        };
        for (id, stored_path) in rows {
            let path = self.safe_stored_path(&stored_path)?;
            if self.index_pdf_item(&id, &path)? {
                result.indexed += 1;
            } else {
                result.failed += 1;
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_syntax_and_quotes() {
        assert_eq!(
            parse_query("中文资料 type:file tag:\"重要 文档\" collection:工作 date:>2025-01-02"),
            ParsedQuery {
                text: vec!["中文资料".into()],
                item_types: vec!["file".into()],
                tags: vec!["重要 文档".into()],
                collections: vec!["工作".into()],
                dates: vec![('>', "2025-01-02".into())],
            }
        );
        assert_eq!(parse_query("type:nope").text, ["type:nope"]);
        assert!(fts_query(&["中文资料".into()]).is_some());
        assert!(fts_query(&["中文".into()]).is_none());
    }
}
