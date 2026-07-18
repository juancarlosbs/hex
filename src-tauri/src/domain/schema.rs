use serde::{Deserialize, Serialize};

/// The shape of a SOAP operation input. Immutable tree derived from XSD.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaNode {
    pub name: String,
    pub namespace: Option<String>,
    pub occurs: Occurs,
    pub nillable: bool,
    pub doc: Option<String>,
    pub attributes: Vec<Attribute>,
    pub kind: NodeKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Leaf {
        #[serde(rename = "xsdType")]
        xsd_type: XsdType,
        #[serde(rename = "enumValues")]
        enum_values: Vec<String>,
        default: Option<String>,
        fixed: Option<String>,
    },
    Sequence(Vec<SchemaNode>),
    Choice(Vec<SchemaNode>),
    Any,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurs {
    pub min: u32,
    pub max: MaxOccurs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaxOccurs {
    Bounded(u32),
    Unbounded,
}

impl Occurs {
    pub fn optional(&self) -> bool {
        self.min == 0
    }
    pub fn repeatable(&self) -> bool {
        matches!(self.max, MaxOccurs::Unbounded)
            || matches!(self.max, MaxOccurs::Bounded(n) if n > 1)
    }
}

/// Subset of simple types supported in MVP (ADR-010).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XsdType {
    String,
    Boolean,
    Integer,
    Decimal,
    Double,
    Date,
    DateTime,
    Time,
    GYearMonth,
    Base64Binary,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribute {
    pub name: String,
    pub xsd_type: XsdType,
    pub required: bool,
    pub enum_values: Vec<String>,
    pub default: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn occurs_optional_and_repeatable() {
        let opt = Occurs { min: 0, max: MaxOccurs::Bounded(1) };
        assert!(opt.optional());
        assert!(!opt.repeatable());

        let req_many = Occurs { min: 1, max: MaxOccurs::Unbounded };
        assert!(!req_many.optional());
        assert!(req_many.repeatable());

        let bounded_many = Occurs { min: 1, max: MaxOccurs::Bounded(3) };
        assert!(bounded_many.repeatable());
    }

    #[test]
    fn leaf_node_serializes_to_camel_case_json() {
        let node = SchemaNode {
            name: "a".into(),
            namespace: Some("http://ex".into()),
            occurs: Occurs { min: 1, max: MaxOccurs::Bounded(1) },
            nillable: false,
            doc: None,
            attributes: vec![],
            kind: NodeKind::Leaf {
                xsd_type: XsdType::Integer,
                enum_values: vec![],
                default: None,
                fixed: None,
            },
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("\"enumValues\":[]"), "got: {json}");
        assert!(json.contains("\"xsdType\":\"integer\""), "got: {json}");
    }
}
