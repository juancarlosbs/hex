use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct PostmanCollection {
    pub info: PostmanInfo,
    pub item: Vec<PostmanItem>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanInfo {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct PostmanItem {
    pub name: String,
    #[serde(default)]
    pub item: Option<Vec<PostmanItem>>,
    #[serde(default)]
    pub request: Option<PostmanRequest>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanRequest {
    pub method: String,
    #[serde(default)]
    pub url: Option<PostmanUrl>,
    #[serde(default)]
    pub header: Vec<PostmanKeyValue>,
    #[serde(default)]
    pub body: Option<PostmanBody>,
    #[serde(default)]
    pub auth: Option<PostmanAuth>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PostmanUrl {
    Detailed {
        raw: String,
        #[serde(default)]
        query: Vec<PostmanQueryParam>,
    },
    Raw(String),
}

#[derive(Debug, Deserialize)]
pub struct PostmanQueryParam {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanKeyValue {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanBody {
    pub mode: String,
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub urlencoded: Vec<PostmanKeyValue>,
    #[serde(default)]
    pub formdata: Vec<PostmanKeyValue>,
    #[serde(default)]
    pub graphql: Option<PostmanGraphql>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanGraphql {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub variables: String,
}

#[derive(Debug, Deserialize)]
pub struct PostmanAuth {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub basic: Vec<PostmanAuthParam>,
    #[serde(default)]
    pub bearer: Vec<PostmanAuthParam>,
    #[serde(default)]
    pub apikey: Vec<PostmanAuthParam>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanAuthParam {
    pub key: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct PostmanEnvironment {
    pub name: String,
    #[serde(default)]
    pub values: Vec<PostmanEnvValue>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanEnvValue {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

pub fn parse_collection(json: &str) -> Result<PostmanCollection, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid Postman collection: {e}"))
}

pub fn parse_environment(json: &str) -> Result<PostmanEnvironment, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid Postman environment: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = include_str!("testdata/sample_collection.json");
    const SAMPLE_ENV: &str = include_str!("testdata/sample_environment.json");

    #[test]
    fn parses_sample_collection() {
        let pc = parse_collection(SAMPLE).unwrap();
        assert_eq!(pc.info.name, "Sample API");
        assert_eq!(pc.item.len(), 2);
        assert_eq!(pc.item[0].name, "Auth");
        assert!(pc.item[0].item.is_some());
        assert!(pc.item[0].request.is_none());
    }

    #[test]
    fn parses_sample_environment() {
        let pe = parse_environment(SAMPLE_ENV).unwrap();
        assert_eq!(pe.name, "Sample Env");
        assert_eq!(pe.values.len(), 2);
    }

    #[test]
    fn rejects_invalid_json() {
        let err = parse_collection("not json").unwrap_err();
        assert!(err.contains("invalid Postman collection"));
    }
}
