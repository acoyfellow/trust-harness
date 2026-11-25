mod command;
mod lockfile;

pub use command::{admit_command, extract_bash_target_paths};
pub use lockfile::{admit_lockfile, parse_policy, policy_sha256};

use serde::{Deserialize, Serialize};

const DEFAULT_POLICY_JSON: &str = r#"{"publicHosts":["registry.npmjs.org","registry.yarnpkg.com","registry.npmmirror.com","npm.pkg.github.com","codeload.github.com","github.com","api.github.com","objects.githubusercontent.com","gitlab.com","bitbucket.org"],"suspiciousHostContains":[".corp."],"suspiciousHostSuffixes":[".internal",".local"]}"#;

fn default_policy_json() -> String {
    DEFAULT_POLICY_JSON.to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decision {
    pub allow: bool,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AdmitRequest {
    Bash { command: String },
    Write { path: String, content: String },
    Edit { path: String, payload: String },
    Lockfile {
        text: String,
        #[serde(rename = "policyJson", default = "default_policy_json")]
        policy_json: String,
    },
}

pub fn evaluate(action: AdmitRequest) -> Decision {
    match action {
        AdmitRequest::Bash { command } => {
            let target_paths = extract_bash_target_paths(&command);
            admit_command("bash", &command, &target_paths)
        }
        AdmitRequest::Write { path, content } => {
            admit_command("write", &content, std::slice::from_ref(&path))
        }
        AdmitRequest::Edit { path, payload } => {
            admit_command("edit", &payload, std::slice::from_ref(&path))
        }
        AdmitRequest::Lockfile { text, policy_json } => {
            let result = admit_lockfile(&text, &policy_json);
            Decision {
                allow: result.allow,
                reason: result.reason,
            }
        }
    }
}

pub fn eval_json(input: &str) -> String {
    match serde_json::from_str::<AdmitRequest>(input) {
        Ok(request) => serde_json::to_string(&evaluate(request))
            .unwrap_or_else(|_| "{\"error\":\"serialize\"}".to_string()),
        Err(error) => serde_json::json!({ "error": error.to_string() }).to_string(),
    }
}

trust_abi::export_judge!(eval_json);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denies_secret_paths_and_allows_src_write() {
        assert!(!evaluate(AdmitRequest::Write { path: ".env".into(), content: "A=1".into() }).allow);
        assert!(!evaluate(AdmitRequest::Write { path: ".dev.vars".into(), content: "A=1".into() }).allow);
        assert!(evaluate(AdmitRequest::Write { path: "src/index.ts".into(), content: "export {}".into() }).allow);
    }

    #[test]
    fn denies_npmrc_edit() {
        assert!(!evaluate(AdmitRequest::Edit { path: "pkg/.npmrc".into(), payload: "token".into() }).allow);
    }

    #[test]
    fn enforces_force_push_and_hooks_and_dd_env() {
        assert!(!evaluate(AdmitRequest::Bash { command: "git commit --no-verify -m x".into() }).allow);
        assert!(!evaluate(AdmitRequest::Bash { command: "git commit -n -m x".into() }).allow);
        assert!(!evaluate(AdmitRequest::Bash { command: "git commit -an -m x".into() }).allow);
        assert!(!evaluate(AdmitRequest::Bash { command: "git commit -nm\"ok\"".into() }).allow);
        assert!(!evaluate(AdmitRequest::Bash { command: "git commit -m\"ok\" -n".into() }).allow);
        assert!(evaluate(AdmitRequest::Bash { command: "git commit -m \"never use -n\"".into() }).allow);
        assert!(evaluate(AdmitRequest::Bash { command: "git commit -m\"don't break main\"".into() }).allow);
        assert!(evaluate(AdmitRequest::Bash { command: "git commit -m\"no\"".into() }).allow);
        assert!(evaluate(AdmitRequest::Bash { command: "git commit -am\"no\"".into() }).allow);
        assert!(evaluate(AdmitRequest::Bash { command: "git commit -Fnotes.txt".into() }).allow);
        assert!(!evaluate(AdmitRequest::Bash { command: "git push origin +HEAD:main".into() }).allow);
        assert!(evaluate(AdmitRequest::Bash { command: "git push --force origin feature".into() }).allow);
        assert!(!evaluate(AdmitRequest::Bash { command: "dd if=foo of=.env".into() }).allow);
        assert!(evaluate(AdmitRequest::Bash { command: "rg -n 'process\\.env' src".into() }).allow);
    }

    #[test]
    fn denies_non_public_and_http_lockfile_registries() {
        let bad = r#"{"resolved":"https://npm.corp.acme.example/pkg-1.0.tgz"}"#;
        let http = r#"{"resolved":"http://registry.npmjs.org/pkg-1.0.tgz"}"#;
        let ok = r#"{"resolved":"https://registry.npmjs.org/pkg-1.0.tgz"}"#;
        assert!(!evaluate(AdmitRequest::Lockfile { text: bad.into(), policy_json: default_policy_json() }).allow);
        assert!(!evaluate(AdmitRequest::Lockfile { text: http.into(), policy_json: default_policy_json() }).allow);
        assert!(evaluate(AdmitRequest::Lockfile { text: ok.into(), policy_json: default_policy_json() }).allow);
    }
}
