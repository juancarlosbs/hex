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

/// Result of diffing the operations of a re-fetched WSDL against the ones
/// currently imported (product.md F6). Pure data — applying it is persistence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OperationDiff {
    /// Operations present in the fresh WSDL but not imported yet.
    pub added: Vec<OperationRef>,
    /// Names of imported operations that no longer exist in the fresh WSDL.
    pub removed: Vec<String>,
    /// Fresh version of operations whose metadata differs from the imported one.
    pub changed: Vec<OperationRef>,
}

/// Diff operations by name. `changed` carries the fresh `OperationRef` for any
/// name present on both sides whose endpoint/action/version/input differ.
pub fn diff_operations(current: &[OperationRef], fresh: &[OperationRef]) -> OperationDiff {
    let mut diff = OperationDiff {
        added: vec![],
        removed: vec![],
        changed: vec![],
    };
    for op in fresh {
        match current.iter().find(|c| c.name == op.name) {
            None => diff.added.push(op.clone()),
            Some(cur) if cur != op => diff.changed.push(op.clone()),
            Some(_) => {}
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
    fn identical_sets_produce_empty_diff() {
        let ops = vec![op("Add", "http://x/svc"), op("Sub", "http://x/svc")];
        let diff = diff_operations(&ops, &ops);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert!(diff.changed.is_empty());
    }

    #[test]
    fn new_operation_is_added() {
        let current = vec![op("Add", "http://x/svc")];
        let fresh = vec![op("Add", "http://x/svc"), op("Mul", "http://x/svc")];
        let diff = diff_operations(&current, &fresh);
        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.added[0].name, "Mul");
        assert!(diff.removed.is_empty());
        assert!(diff.changed.is_empty());
    }

    #[test]
    fn missing_operation_is_removed_by_name() {
        let current = vec![op("Add", "http://x/svc"), op("Sub", "http://x/svc")];
        let fresh = vec![op("Add", "http://x/svc")];
        let diff = diff_operations(&current, &fresh);
        assert_eq!(diff.removed, vec!["Sub".to_string()]);
        assert!(diff.added.is_empty());
        assert!(diff.changed.is_empty());
    }

    #[test]
    fn metadata_change_is_reported_with_fresh_ref() {
        let current = vec![op("Add", "http://old/svc")];
        let fresh = vec![op("Add", "http://new/svc")];
        let diff = diff_operations(&current, &fresh);
        assert_eq!(diff.changed.len(), 1);
        assert_eq!(diff.changed[0].endpoint, "http://new/svc");
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
    }

    #[test]
    fn soap_version_or_input_element_change_counts_as_changed() {
        let current = vec![op("Add", "http://x/svc")];
        let mut v12 = op("Add", "http://x/svc");
        v12.soap_version = SoapVersion::V12;
        let diff = diff_operations(&current, &[v12]);
        assert_eq!(diff.changed.len(), 1);

        let mut renamed_input = op("Add", "http://x/svc");
        renamed_input.input_element.local = "AddRequest".into();
        let diff = diff_operations(&current, &[renamed_input]);
        assert_eq!(diff.changed.len(), 1);
    }

    #[test]
    fn add_remove_and_change_combine() {
        let current = vec![op("Add", "http://x/svc"), op("Sub", "http://x/svc")];
        let fresh = vec![op("Add", "http://y/svc"), op("Mul", "http://y/svc")];
        let diff = diff_operations(&current, &fresh);
        assert_eq!(diff.added[0].name, "Mul");
        assert_eq!(diff.removed, vec!["Sub".to_string()]);
        assert_eq!(diff.changed[0].name, "Add");
    }
}
