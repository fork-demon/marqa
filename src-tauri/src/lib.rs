use pulldown_cmark::{html, Options, Parser};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[derive(Serialize, Deserialize)]
pub struct AgentFileInfo {
    pub file_type: String, // "CLAUDE.md", "AGENTS.md", "cursorrules", etc.
    pub path: String,
    pub exists: bool,
}

#[tauri::command]
fn parse_markdown(content: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let parser = Parser::new_ext(content, options);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    html_output
}

#[tauri::command]
fn read_directory(path: &str) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(path);
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    read_dir_recursive(dir_path, 0, 1)
}

#[tauri::command]
fn read_directory_children(path: &str) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(path);
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    read_dir_recursive(dir_path, 0, 1)
}

fn read_dir_recursive(path: &Path, depth: usize, max_depth: usize) -> Result<Vec<FileEntry>, String> {
    let mut entries: Vec<FileEntry> = Vec::new();

    let read_dir = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') {
            continue;
        }

        if entry_path.is_dir() {
            let skip_dirs = ["node_modules", "target", ".git", "dist", "build", "__pycache__"];
            if skip_dirs.contains(&name.as_str()) {
                continue;
            }
        }

        let is_dir = entry_path.is_dir();
        let children = if is_dir && depth < max_depth {
            Some(read_dir_recursive(&entry_path, depth + 1, max_depth).unwrap_or_default())
        } else if is_dir {
            Some(Vec::new())
        } else {
            None
        };

        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }

    entries.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(entries)
}

#[tauri::command]
fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn write_file(path: &str, content: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn get_default_dir() -> String {
    dirs_next::document_dir()
        .or_else(dirs_next::home_dir)
        .unwrap_or_else(|| PathBuf::from("/"))
        .to_string_lossy()
        .to_string()
}

/// Detect agent configuration files in a project directory
#[tauri::command]
fn detect_agent_files(project_path: &str) -> Vec<AgentFileInfo> {
    let base = Path::new(project_path);
    let agent_files = vec![
        ("CLAUDE.md", "CLAUDE.md"),
        ("AGENTS.md", "AGENTS.md"),
        (".cursorrules", ".cursorrules"),
        (".github/copilot-instructions.md", "copilot-instructions"),
        (".windsurfrules", ".windsurfrules"),
        ("GEMINI.md", "GEMINI.md"),
        (".cursor/rules", "cursor-rules-dir"),
    ];

    agent_files
        .iter()
        .map(|(rel_path, file_type)| {
            let full_path = base.join(rel_path);
            AgentFileInfo {
                file_type: file_type.to_string(),
                path: full_path.to_string_lossy().to_string(),
                exists: full_path.exists(),
            }
        })
        .collect()
}

/// Generate agent file content from a template
#[tauri::command]
fn generate_agent_template(template_type: &str, project_name: &str, tech_stack: &str, description: &str) -> String {
    match template_type {
        "CLAUDE.md" => format!(
r#"# {project_name}

{description}

## Tech Stack
{tech_stack}

## Project Structure
<!-- Describe key directories and their purpose -->

## Development Commands
```bash
# Install dependencies
# npm install

# Run development server
# npm run dev

# Run tests
# npm test

# Build for production
# npm run build
```

## Coding Guidelines
- Follow existing code style and patterns
- Write clear, descriptive variable and function names
- Add comments for complex logic
- Keep functions small and focused

## Testing
- Write tests for new features
- Ensure existing tests pass before committing
- Use descriptive test names

## Important Notes
<!-- Add project-specific instructions for AI agents -->
"#),
        "AGENTS.md" => format!(
r#"# {project_name}

{description}

## Objective
Help developers work with this codebase effectively.

## Tech Stack
{tech_stack}

## Commands
```bash
# Build
# npm run build

# Test
# npm test

# Lint
# npm run lint
```

## Project Structure
<!-- Key directories and what they contain -->

## Coding Standards
- Follow the existing patterns in the codebase
- Use TypeScript strict mode where applicable
- Prefer composition over inheritance
- Write unit tests for business logic

## Boundaries
- Do not modify configuration files without explicit instruction
- Do not delete or rename existing public APIs
- Ask before making architectural changes
"#),
        ".cursorrules" => format!(
r#"You are working on {project_name}.

{description}

Tech stack: {tech_stack}

Guidelines:
- Follow existing code patterns and style
- Write clean, readable code with proper error handling
- Add TypeScript types where applicable
- Prefer small, focused functions
- Use meaningful variable and function names

When writing code:
- Check for existing similar patterns in the codebase first
- Maintain backwards compatibility
- Add appropriate comments for complex logic
- Follow the project's testing conventions
"#),
        "copilot-instructions" => format!(
r#"# {project_name} - Copilot Instructions

{description}

## Tech Stack
{tech_stack}

## Coding Style
- Follow existing patterns in the codebase
- Use descriptive names for variables and functions
- Keep functions small and focused
- Add error handling where appropriate

## Testing
- Write tests for new functionality
- Follow existing test patterns
- Use descriptive test names
"#),
        _ => format!("# {project_name}\n\n{description}\n\nTech stack: {tech_stack}\n"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            parse_markdown,
            read_directory,
            read_directory_children,
            read_file,
            write_file,
            get_default_dir,
            detect_agent_files,
            generate_agent_template,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
