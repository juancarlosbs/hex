use crate::domain::value::FormValue;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

/// An environment (dev/staging/prod) with its variables. Persisted one file per
/// environment (persistence/environment.rs) and sent over IPC on Send.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Environment {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
}

#[derive(Debug, Error, PartialEq)]
pub enum EnvError {
    #[error("unknown environment variable: {{{{{0}}}}}")]
    UnknownVar(String),
}

/// Substitutes `{{key}}` with values from `vars`. Missing variable -> UnknownVar
/// (never a silent literal passthrough). Text without a matching `}}` and empty
/// `{{}}` are left literal; on nested opens (`{{a{{b}}`) the innermost pair wins.
pub fn interpolate(template: &str, vars: &BTreeMap<String, String>) -> Result<String, EnvError> {
    let mut out = String::with_capacity(template.len());
    let mut i = 0;
    while let Some(rel) = template[i..].find("{{") {
        let open = i + rel;
        let Some(rel_close) = template[open + 2..].find("}}") else {
            break; // unclosed — rest is literal
        };
        let close = open + 2 + rel_close;
        let raw_key = &template[open + 2..close];
        if let Some(inner) = raw_key.rfind("{{") {
            // nested open: everything before the innermost `{{` is literal
            out.push_str(&template[i..open + 2 + inner]);
            i = open + 2 + inner;
            continue;
        }
        let key = raw_key.trim();
        if key.is_empty() {
            out.push_str(&template[i..close + 2]);
            i = close + 2;
            continue;
        }
        match vars.get(key) {
            Some(value) => {
                out.push_str(&template[i..open]);
                out.push_str(value);
                i = close + 2;
            }
            None => return Err(EnvError::UnknownVar(key.to_string())),
        }
    }
    out.push_str(&template[i..]);
    Ok(out)
}

/// Interpolates every textual leaf of a form value tree (SOAP envelope inputs).
pub fn interpolate_form_value(
    value: &FormValue,
    vars: &BTreeMap<String, String>,
) -> Result<FormValue, EnvError> {
    Ok(match value {
        FormValue::Leaf(Some(s)) => FormValue::Leaf(Some(interpolate(s, vars)?)),
        FormValue::Raw(s) => FormValue::Raw(interpolate(s, vars)?),
        FormValue::Sequence(items) => FormValue::Sequence(
            items
                .iter()
                .map(|v| interpolate_form_value(v, vars))
                .collect::<Result<_, _>>()?,
        ),
        FormValue::Repeated(items) => FormValue::Repeated(
            items
                .iter()
                .map(|v| interpolate_form_value(v, vars))
                .collect::<Result<_, _>>()?,
        ),
        FormValue::Choice { branch, value } => FormValue::Choice {
            branch: *branch,
            value: Box::new(interpolate_form_value(value, vars)?),
        },
        other => other.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn passes_through_text_without_placeholders() {
        assert_eq!(
            interpolate("https://api.dev/users", &vars(&[])).unwrap(),
            "https://api.dev/users"
        );
    }

    #[test]
    fn substitutes_single_and_multiple_vars() {
        let v = vars(&[("host", "api.dev"), ("id", "42")]);
        assert_eq!(
            interpolate("https://{{host}}/users/{{id}}", &v).unwrap(),
            "https://api.dev/users/42"
        );
    }

    #[test]
    fn trims_whitespace_inside_braces() {
        let v = vars(&[("host", "api.dev")]);
        assert_eq!(interpolate("{{ host }}", &v).unwrap(), "api.dev");
    }

    #[test]
    fn empty_value_substitutes_empty_string() {
        let v = vars(&[("token", "")]);
        assert_eq!(interpolate("Bearer {{token}}", &v).unwrap(), "Bearer ");
    }

    #[test]
    fn unknown_var_is_a_clear_error_not_a_passthrough() {
        let err = interpolate("https://{{host}}/x", &vars(&[])).unwrap_err();
        assert_eq!(err, EnvError::UnknownVar("host".into()));
        assert_eq!(err.to_string(), "unknown environment variable: {{host}}");
    }

    #[test]
    fn unclosed_braces_stay_literal() {
        let v = vars(&[("a", "1")]);
        assert_eq!(interpolate("x{{a", &v).unwrap(), "x{{a");
    }

    #[test]
    fn empty_braces_stay_literal() {
        assert_eq!(interpolate("x{{}}y", &vars(&[])).unwrap(), "x{{}}y");
    }

    #[test]
    fn nested_braces_resolve_the_innermost_pair() {
        let v = vars(&[("host", "api.dev")]);
        assert_eq!(
            interpolate("x{{a{{host}}b}}y", &v).unwrap(),
            "x{{aapi.devb}}y"
        );
    }

    #[test]
    fn nested_braces_with_unknown_inner_var_error() {
        let err = interpolate("{{a{{nope}}}}", &vars(&[])).unwrap_err();
        assert_eq!(err, EnvError::UnknownVar("nope".into()));
    }

    #[test]
    fn form_value_leaves_and_raw_are_interpolated_recursively() {
        let v = vars(&[("name", "Ada")]);
        let input = FormValue::Sequence(vec![
            FormValue::Leaf(Some("{{name}}".into())),
            FormValue::Leaf(None),
            FormValue::Nil,
            FormValue::Choice {
                branch: 1,
                value: Box::new(FormValue::Raw("<x>{{name}}</x>".into())),
            },
            FormValue::Repeated(vec![FormValue::Leaf(Some("hi {{name}}".into()))]),
        ]);
        let out = interpolate_form_value(&input, &v).unwrap();
        assert_eq!(
            out,
            FormValue::Sequence(vec![
                FormValue::Leaf(Some("Ada".into())),
                FormValue::Leaf(None),
                FormValue::Nil,
                FormValue::Choice {
                    branch: 1,
                    value: Box::new(FormValue::Raw("<x>Ada</x>".into())),
                },
                FormValue::Repeated(vec![FormValue::Leaf(Some("hi Ada".into()))]),
            ])
        );
    }

    #[test]
    fn form_value_unknown_var_errors() {
        let input = FormValue::Leaf(Some("{{missing}}".into()));
        assert_eq!(
            interpolate_form_value(&input, &vars(&[])).unwrap_err(),
            EnvError::UnknownVar("missing".into())
        );
    }
}
