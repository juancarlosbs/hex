use super::error::DomainError;
use super::value::FormValue;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A named set of variables. BTreeMap keeps TOML/JSON output sorted -> stable git diffs.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Environment {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
}

/// Substitutes {{key}} with values from the environment (docs/domain-model.md §6).
/// Unknown variable -> DomainError::UnknownVar. Unclosed "{{" and empty "{{}}"
/// are not references and pass through verbatim.
pub fn interpolate(template: &str, env: &Environment) -> Result<String, DomainError> {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[start..]);
            return Ok(out);
        };
        let key = after[..end].trim();
        if key.is_empty() {
            out.push_str(&rest[start..start + 2 + end + 2]);
        } else {
            match env.variables.get(key) {
                Some(value) => out.push_str(value),
                None => return Err(DomainError::UnknownVar(key.to_string())),
            }
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Interpolates every user-typed string in a form value tree: Leaf text and Raw XML.
pub fn interpolate_form_value(
    value: &FormValue,
    env: &Environment,
) -> Result<FormValue, DomainError> {
    Ok(match value {
        FormValue::Leaf(Some(s)) => FormValue::Leaf(Some(interpolate(s, env)?)),
        FormValue::Raw(s) => FormValue::Raw(interpolate(s, env)?),
        FormValue::Sequence(items) => FormValue::Sequence(
            items
                .iter()
                .map(|v| interpolate_form_value(v, env))
                .collect::<Result<_, _>>()?,
        ),
        FormValue::Repeated(items) => FormValue::Repeated(
            items
                .iter()
                .map(|v| interpolate_form_value(v, env))
                .collect::<Result<_, _>>()?,
        ),
        FormValue::Choice { branch, value } => FormValue::Choice {
            branch: *branch,
            value: Box::new(interpolate_form_value(value, env)?),
        },
        other => other.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Environment {
        Environment {
            id: "e1".into(),
            name: "Dev".into(),
            variables: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    #[test]
    fn replaces_single_var_mid_string() {
        let e = env(&[("host", "api.dev")]);
        assert_eq!(
            interpolate("https://{{host}}/x", &e).unwrap(),
            "https://api.dev/x"
        );
    }

    #[test]
    fn replaces_multiple_vars() {
        let e = env(&[("a", "1"), ("b", "2")]);
        assert_eq!(interpolate("{{a}}-{{b}}-{{a}}", &e).unwrap(), "1-2-1");
    }

    #[test]
    fn trims_whitespace_inside_braces() {
        let e = env(&[("host", "api.dev")]);
        assert_eq!(interpolate("{{ host }}", &e).unwrap(), "api.dev");
    }

    #[test]
    fn unknown_var_errors_with_name() {
        let e = env(&[]);
        let err = interpolate("{{missing}}", &e).unwrap_err();
        assert_eq!(err.to_string(), "undefined variable: {{missing}}");
    }

    #[test]
    fn empty_braces_pass_through_as_literal() {
        let e = env(&[]);
        assert_eq!(interpolate("a{{}}b", &e).unwrap(), "a{{}}b");
        assert_eq!(interpolate("a{{  }}b", &e).unwrap(), "a{{  }}b");
    }

    #[test]
    fn unclosed_braces_pass_through_as_literal() {
        let e = env(&[("a", "1")]);
        assert_eq!(interpolate("x{{a", &e).unwrap(), "x{{a");
    }

    #[test]
    fn no_references_returns_input_unchanged() {
        let e = env(&[]);
        assert_eq!(interpolate("plain text", &e).unwrap(), "plain text");
    }

    #[test]
    fn empty_value_replaces_with_empty_string() {
        let e = env(&[("token", "")]);
        assert_eq!(interpolate("x{{token}}y", &e).unwrap(), "xy");
    }

    #[test]
    fn form_value_interpolates_leaves_and_raw_recursively() {
        use crate::domain::value::FormValue;
        let e = env(&[("v", "42")]);
        let input = FormValue::Sequence(vec![
            FormValue::Leaf(Some("{{v}}".into())),
            FormValue::Repeated(vec![FormValue::Raw("<x>{{v}}</x>".into())]),
            FormValue::Omitted,
        ]);
        let out = interpolate_form_value(&input, &e).unwrap();
        let FormValue::Sequence(items) = out else {
            panic!("expected sequence")
        };
        assert!(matches!(&items[0], FormValue::Leaf(Some(s)) if s == "42"));
        let FormValue::Repeated(reps) = &items[1] else {
            panic!("expected repeated")
        };
        assert!(matches!(&reps[0], FormValue::Raw(s) if s == "<x>42</x>"));
        assert!(matches!(&items[2], FormValue::Omitted));
    }

    #[test]
    fn form_value_unknown_var_errors() {
        use crate::domain::value::FormValue;
        let e = env(&[]);
        let input = FormValue::Leaf(Some("{{nope}}".into()));
        assert!(interpolate_form_value(&input, &e).is_err());
    }
}
