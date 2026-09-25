use tauri::{plugin::{Builder, TauriPlugin}, Runtime};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("studytools")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("com.exameow.studytools", "StudyToolsPlugin")?;
            Ok(())
        })
        .build()
}
