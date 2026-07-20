use serde::{Deserialize, Serialize};

/// The instance the user filled in. Mirrors `NodeKind`; the serializer walks the
/// pair (SchemaNode, FormValue). See docs/domain-model.md §3.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormValue {
    Leaf(Option<String>),
    Sequence(Vec<FormValue>),
    Choice {
        branch: usize,
        value: Box<FormValue>,
    },
    Repeated(Vec<FormValue>),
    Nil,
    Omitted,
    Raw(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn form_value_serde_roundtrip_shapes() {
        assert_eq!(serde_json::to_string(&FormValue::Nil).unwrap(), "\"nil\"");
        assert_eq!(
            serde_json::to_string(&FormValue::Omitted).unwrap(),
            "\"omitted\""
        );
        assert_eq!(
            serde_json::to_string(&FormValue::Leaf(Some("v".into()))).unwrap(),
            "{\"leaf\":\"v\"}"
        );
        let choice = FormValue::Choice {
            branch: 1,
            value: Box::new(FormValue::Leaf(None)),
        };
        assert_eq!(
            serde_json::to_string(&choice).unwrap(),
            "{\"choice\":{\"branch\":1,\"value\":{\"leaf\":null}}}"
        );
        // deserialize the frontend-produced shape back
        let back: FormValue = serde_json::from_str("{\"repeated\":[\"nil\"]}").unwrap();
        assert_eq!(back, FormValue::Repeated(vec![FormValue::Nil]));
    }
}
