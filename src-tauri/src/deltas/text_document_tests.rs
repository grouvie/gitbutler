use crate::deltas::{operations::Operation, text_document::TextDocument, Delta};

#[test]
fn test_new() {
    let document = TextDocument::new("hello world", vec![]);
    assert_eq!(document.to_string(), "hello world");
    assert_eq!(document.get_deltas().len(), 0);
}

#[test]
fn test_update() {
    let mut document = TextDocument::new("hello world", vec![]);
    document.update("hello world!");
    assert_eq!(document.to_string(), "hello world!");
    assert_eq!(document.get_deltas().len(), 1);
    assert_eq!(document.get_deltas()[0].operations.len(), 1);
    assert_eq!(
        document.get_deltas()[0].operations[0],
        Operation::Insert((11, "!".to_string()))
    );
}

#[test]
fn test_empty() {
    let mut document = TextDocument::from_deltas(vec![]);
    document.update("hello world!");
    assert_eq!(document.to_string(), "hello world!");
    assert_eq!(document.get_deltas().len(), 1);
    assert_eq!(document.get_deltas()[0].operations.len(), 1);
    assert_eq!(
        document.get_deltas()[0].operations[0],
        Operation::Insert((0, "hello world!".to_string()))
    );
}

#[test]
fn test_from_deltas() {
    let document = TextDocument::from_deltas(vec![
        Delta {
            timestamp_ms: 0,
            operations: vec![Operation::Insert((0, "hello".to_string()))],
        },
        Delta {
            timestamp_ms: 1,
            operations: vec![Operation::Insert((5, " world".to_string()))],
        },
        Delta {
            timestamp_ms: 2,
            operations: vec![
                Operation::Delete((3, 7)),
                Operation::Insert((4, "!".to_string())),
            ],
        },
    ]);
    assert_eq!(document.to_string(), "held!");
}

#[test]
fn test_complex() {
    let mut document = TextDocument::from_deltas(vec![]);

    document.update("hello");
    assert_eq!(document.to_string(), "hello");
    assert_eq!(document.get_deltas().len(), 1);
    assert_eq!(document.get_deltas()[0].operations.len(), 1);
    assert_eq!(
        document.get_deltas()[0].operations[0],
        Operation::Insert((0, "hello".to_string()))
    );

    document.update("hello world");
    assert_eq!(document.to_string(), "hello world");
    assert_eq!(document.get_deltas().len(), 2);
    assert_eq!(document.get_deltas()[1].operations.len(), 1);
    assert_eq!(
        document.get_deltas()[1].operations[0],
        Operation::Insert((5, " world".to_string()))
    );

    document.update("held!");
    assert_eq!(document.to_string(), "held!");
    assert_eq!(document.get_deltas().len(), 3);
    assert_eq!(document.get_deltas()[2].operations.len(), 2);
    assert_eq!(
        document.get_deltas()[2].operations[0],
        Operation::Delete((3, 7))
    );
    assert_eq!(
        document.get_deltas()[2].operations[1],
        Operation::Insert((4, "!".to_string())),
    );
}
