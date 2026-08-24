// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod erp;
mod watcher;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|_app| {
            let chemin_dossier = "./../Test".to_string();
            let chemin_db = "affaires.db".to_string();

            std::thread::spawn(move || {
                if let Err(e) = watcher::surveiller_dossier(&chemin_dossier, &chemin_db) {
                    eprintln!("Erreur watcher: {e:?}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
