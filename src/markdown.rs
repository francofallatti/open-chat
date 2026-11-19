//! Markdown del modelo -> HTML seguro para insertar en la vista.

use pulldown_cmark::{html, Options, Parser};

/// Convierte markdown en HTML saneado. El texto viene de un modelo, así que se
/// trata como no confiable: se eliminan scripts, manejadores de eventos e
/// imágenes (una imagen remota haría una petición de red sin que el usuario la pida).
pub fn render(text: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);

    let mut raw = String::with_capacity(text.len() * 3 / 2);
    html::push_html(&mut raw, Parser::new_ext(text, options));

    ammonia::Builder::default()
        .rm_tags(["img"])
        .add_tag_attributes("code", ["class"])
        .clean(&raw)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::render;

    #[test]
    fn renders_basic_markdown() {
        let html = render("**hola**\n\n- uno\n- dos\n\n```rust\nfn main() {}\n```");
        assert!(html.contains("<strong>hola</strong>"));
        assert!(html.contains("<li>uno</li>"));
        assert!(html.contains("<code class=\"language-rust\">"));
    }

    #[test]
    fn strips_active_content() {
        let html = render(
            "<script>alert(1)</script><a href=\"javascript:alert(1)\" onclick=\"x()\">a</a>\
             <img src=\"https://example.com/x.png\">",
        );
        assert!(!html.contains("<script"));
        assert!(!html.contains("javascript:"));
        assert!(!html.contains("onclick"));
        assert!(!html.contains("<img"));
    }

    #[test]
    fn renders_tables() {
        let html = render("| a | b |\n|---|---|\n| 1 | 2 |");
        assert!(html.contains("<table>"));
        assert!(html.contains("<td>1</td>"));
    }
}
