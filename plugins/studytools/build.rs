const COMMANDS: &[&str] = &[
    "has_usage_access",
    "open_usage_access_settings",
    "get_usage_stats",
    "take_selected_text",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
