use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct Field {
    pub id: String,
    pub claimed: Option<String>,
    pub found: Option<String>,
    #[serde(default = "anchored_by_default")]
    pub anchored: bool,
}

fn anchored_by_default() -> bool {
    true
}

#[derive(Deserialize)]
pub struct VerdictRequest {
    pub fields: Vec<Field>,
}

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Held,
    Broken,
    Unbacked,
    Unclaimed,
}

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Pass,
    Retry,
    Ask,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Line {
    pub id: String,
    pub status: Status,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Ruling {
    pub lines: Vec<Line>,
    pub held: usize,
    pub broken: usize,
    pub unbacked: usize,
    pub action: Action,
}

const PREFIX_MIN: usize = 7;

fn normalize(value: &str) -> String {
    value.trim().to_lowercase().trim_end_matches('/').to_string()
}

pub fn agrees(claimed: &str, found: &str) -> bool {
    let a = normalize(claimed);
    let b = normalize(found);
    a == b || (a.len() >= PREFIX_MIN && b.starts_with(&a)) || (b.len() >= PREFIX_MIN && a.starts_with(&b))
}

pub fn status_of(field: &Field) -> Status {
    let found = if field.anchored { field.found.as_deref() } else { None };
    match (field.claimed.as_deref(), found) {
        (None, _) => Status::Unclaimed,
        (Some(_), None) => Status::Unbacked,
        (Some(claimed), Some(found)) if agrees(claimed, found) => Status::Held,
        (Some(_), Some(_)) => Status::Broken,
    }
}

pub fn action_of(held: usize, broken: usize, unbacked: usize) -> Action {
    if broken > 0 {
        Action::Retry
    } else if unbacked > 0 || held == 0 {
        Action::Ask
    } else {
        Action::Pass
    }
}

pub fn evaluate(request: &VerdictRequest) -> Ruling {
    let lines: Vec<Line> = request
        .fields
        .iter()
        .map(|field| Line { id: field.id.clone(), status: status_of(field) })
        .collect();
    let held = lines.iter().filter(|line| line.status == Status::Held).count();
    let broken = lines.iter().filter(|line| line.status == Status::Broken).count();
    let unbacked = lines.iter().filter(|line| line.status == Status::Unbacked).count();
    let action = action_of(held, broken, unbacked);
    Ruling { lines, held, broken, unbacked, action }
}

pub fn eval_json(input: &str) -> String {
    match serde_json::from_str::<VerdictRequest>(input) {
        Ok(request) => serde_json::to_string(&evaluate(&request)).unwrap_or_else(|_| "{\"error\":\"serialize\"}".to_string()),
        Err(error) => serde_json::json!({ "error": error.to_string() }).to_string(),
    }
}

trust_abi::export_judge!(eval_json);

#[cfg(test)]
mod tests {
    use super::*;

    fn f(id: &str, claimed: Option<&str>, found: Option<&str>, anchored: bool) -> Field {
        Field {
            id: id.into(),
            claimed: claimed.map(str::to_string),
            found: found.map(str::to_string),
            anchored,
        }
    }

    #[test]
    fn broken_claim_triggers_retry() {
        let out = evaluate(&VerdictRequest { fields: vec![f("tests_passed", Some("12"), Some("11"), true)] });
        assert_eq!(out.action, Action::Retry);
        assert_eq!(out.broken, 1);
    }

    #[test]
    fn unbacked_claim_triggers_ask() {
        let out = evaluate(&VerdictRequest { fields: vec![f("deploy_url", Some("https://x.dev"), None, true)] });
        assert_eq!(out.action, Action::Ask);
        assert_eq!(out.unbacked, 1);
    }

    #[test]
    fn unanchored_found_is_unbacked() {
        let out = evaluate(&VerdictRequest { fields: vec![f("tests_passed", Some("12"), Some("12"), false)] });
        assert_eq!(out.action, Action::Ask);
        assert_eq!(out.lines[0].status, Status::Unbacked);
    }

    #[test]
    fn prefix_commit_and_trailing_slash_hold() {
        let out = evaluate(&VerdictRequest {
            fields: vec![
                f("version", Some("a04a587"), Some("a04a5871c2e9"), true),
                f("url", Some("https://Shop.Example.Dev/"), Some("https://shop.example.dev"), true),
            ],
        });
        assert_eq!(out.action, Action::Pass);
        assert_eq!(out.held, 2);
    }

    #[test]
    fn empty_fields_asks_rather_than_passing() {
        let out = evaluate(&VerdictRequest { fields: vec![] });
        assert_eq!(out.action, Action::Ask);
    }
}
