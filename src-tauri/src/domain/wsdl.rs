use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QName {
    pub namespace: String,
    pub local: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, specta::Type)]
pub enum SoapVersion {
    #[serde(rename = "1.1")]
    V11,
    #[serde(rename = "1.2")]
    V12,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OperationRef {
    pub name: String,
    pub endpoint: String,
    pub soap_action: String,
    pub soap_version: SoapVersion,
    pub input_element: QName,
}

/// Result of diffing a re-fetched WSDL's operations against the imported ones
/// (product.md F6). Pure data — applying it lives in persistence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionDiff {
    /// Operations present in the fresh WSDL but not imported yet.
    pub new: Vec<OperationRef>,
    /// Fresh version of operations whose metadata differs from the saved one.
    pub changed: Vec<OperationRef>,
    /// Names of imported operations that no longer exist in the fresh WSDL.
    pub removed: Vec<String>,
    /// Operations present on both sides with identical metadata.
    pub unchanged: u32,
}

/// Diff by operation name. `changed` carries the fresh `OperationRef` for any
/// name on both sides whose endpoint/action/version/input differ.
#[allow(dead_code)]
pub fn diff_operations(current: &[OperationRef], fresh: &[OperationRef]) -> DefinitionDiff {
    let mut diff = DefinitionDiff {
        new: vec![],
        changed: vec![],
        removed: vec![],
        unchanged: 0,
    };
    for op in fresh {
        match current.iter().find(|c| c.name == op.name) {
            None => diff.new.push(op.clone()),
            Some(cur) if cur != op => diff.changed.push(op.clone()),
            Some(_) => diff.unchanged += 1,
        }
    }
    for cur in current {
        if !fresh.iter().any(|op| op.name == cur.name) {
            diff.removed.push(cur.name.clone());
        }
    }
    diff
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(name: &str, endpoint: &str) -> OperationRef {
        OperationRef {
            name: name.into(),
            endpoint: endpoint.into(),
            soap_action: format!("http://x/{name}"),
            soap_version: SoapVersion::V11,
            input_element: QName {
                namespace: "http://x/ns".into(),
                local: name.into(),
            },
        }
    }

    #[test]
    fn identical_sets_produce_empty_diff_and_count_unchanged() {
        let ops = vec![op("Add", "http://x/svc"), op("Sub", "http://x/svc")];
        let diff = diff_operations(&ops, &ops);
        assert!(diff.new.is_empty());
        assert!(diff.changed.is_empty());
        assert!(diff.removed.is_empty());
        assert_eq!(diff.unchanged, 2);
    }

    #[test]
    fn operation_only_in_fresh_is_new() {
        let diff = diff_operations(
            &[op("Add", "http://x/svc")],
            &[op("Add", "http://x/svc"), op("Mul", "http://x/svc")],
        );
        assert_eq!(diff.new, vec![op("Mul", "http://x/svc")]);
        assert_eq!(diff.unchanged, 1);
    }

    #[test]
    fn operation_only_in_current_is_removed_by_name() {
        let diff = diff_operations(
            &[op("Add", "http://x/svc"), op("Sub", "http://x/svc")],
            &[op("Add", "http://x/svc")],
        );
        assert_eq!(diff.removed, vec!["Sub".to_string()]);
    }

    #[test]
    fn metadata_difference_marks_changed_with_fresh_version() {
        let fresh = op("Add", "http://x/v2/svc");
        let diff = diff_operations(&[op("Add", "http://x/svc")], std::slice::from_ref(&fresh));
        assert_eq!(diff.changed, vec![fresh]);
        assert_eq!(diff.unchanged, 0);
    }
}
