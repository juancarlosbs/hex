use super::parse::PostmanEnvironment;
use crate::domain::env::Environment;
use std::collections::BTreeMap;

pub fn map_environment(pe: PostmanEnvironment) -> Environment {
    let variables: BTreeMap<String, String> = pe
        .values
        .into_iter()
        .filter(|v| v.enabled)
        .map(|v| (v.key, v.value))
        .collect();
    Environment {
        id: uuid::Uuid::new_v4().to_string(),
        name: pe.name,
        variables,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::postman::parse::parse_environment;

    const SAMPLE_ENV: &str = include_str!("testdata/sample_environment.json");

    #[test]
    fn drops_disabled_variables() {
        let pe = parse_environment(SAMPLE_ENV).unwrap();
        let env = map_environment(pe);
        assert_eq!(env.name, "Sample Env");
        assert_eq!(env.variables.len(), 1);
        assert_eq!(
            env.variables.get("base_url"),
            Some(&"https://api.example.com".to_string())
        );
        assert!(!env.variables.contains_key("disabled_var"));
        assert!(!env.id.is_empty());
    }
}
