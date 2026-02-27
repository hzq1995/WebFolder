# 📁 WebFolder

A self-hosted, browser-based file manager with a clean Material Design interface.  
Access your files from any device — protected by a password with a 30-day "remember me" cookie.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.8%2B-blue)
![Flask](https://img.shields.io/badge/flask-3.x-lightgrey)

---

## 📸 Screenshot

![WebFolder Screenshot](static/webfolder.png)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔐 Password protection | SHA-256 hashed password; 30-day cookie so you only log in once |
| 📤 Upload with progress | Real-time upload progress bar |
| 📥 Download with progress | Streaming download with progress bar |
| 🗑️ Delete | One-click delete with confirmation dialog |
| 🖼️ Image preview | In-browser preview for common image formats |
| 📝 Text editor | Inline editor for `.txt` and other plain-text files |
| 🎨 Material Design UI | Clean, responsive interface inspired by Google's Material Design |

## 🚀 Quick Start

### Prerequisites

- Python 3.8 or higher
- pip

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Tenzizi/WebFolder.git
cd WebFolder

# 2. (Optional) Create a virtual environment
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Set your password in config.py
#    Edit DEFAULT_PASSWORD in config.py before first run.

# 5. Run
python app.py
```

Open your browser at **http://localhost:5000** and log in with the password you set.

> **Tip:** To change the password, edit `DEFAULT_PASSWORD` in `config.py` and restart the server.

---

## ⚙️ Configuration

All settings live in [`config.py`](config.py):

| Key | Default | Description |
|-----|---------|-------------|
| `DEFAULT_PASSWORD` | `admin123` | **Change this!** Plaintext password (hashed at startup) |
| `SECRET_KEY` | `change-me-...` | Flask session secret – set a random string in production |
| `COOKIE_DAYS` | `30` | How long the auth cookie lasts |
| `UPLOAD_FOLDER` | `./uploads` | Directory where files are stored |
| `MAX_CONTENT_LENGTH` | `2 GB` | Maximum single-file upload size |
| `PORT` | `5000` | Listen port |

---

## 🔌 API Reference

All endpoints are prefixed with `/api/` and require a valid `wf_token` cookie except `/api/login`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/login` | Verify password, set auth cookie |
| `POST` | `/api/logout` | Clear auth cookie |
| `GET` | `/api/files` | List all files with metadata |
| `POST` | `/api/upload` | Upload a file (`multipart/form-data`) |
| `GET` | `/api/download/<filename>` | Stream-download a file |
| `DELETE` | `/api/delete/<filename>` | Delete a file |
| `GET` | `/api/preview/<filename>` | Get file content for preview |
| `PUT` | `/api/edit/<filename>` | Save edited text-file content |

---

## 📂 Project Structure

```
webfolder/
├── app.py              # Flask application & API routes
├── config.py           # All user-configurable settings
├── requirements.txt    # Python dependencies
├── uploads/            # Stored files (excluded from git)
└── static/
    ├── index.html      # Single-page frontend
    ├── css/
    │   └── style.css   # Material Design custom styles
    └── js/
        └── app.js      # Frontend logic (vanilla JS)
```

---

## 🤝 Contributing

1. Fork the repo and create a feature branch
2. Make your changes with clear commit messages
3. Open a Pull Request describing what you changed and why

Please open an issue first for major changes.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
