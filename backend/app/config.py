import os
import socket
from dotenv import load_dotenv

load_dotenv()

GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
GCP_LOCATION = os.getenv("GCP_LOCATION", "europe-west1")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")

def get_lan_ip() -> str:
    """H11: UDP-socket trick to detect local LAN IP for phone QR connectivity."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

lan_ip = get_lan_ip()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", f"http://{lan_ip}:{PORT}").rstrip("/")
CLINICIAN_API_KEY = os.getenv("CLINICIAN_API_KEY", "").strip() or None
ENABLE_UPLOADS = os.getenv("ENABLE_UPLOADS", "false").lower() in ("true", "1", "yes")
ENABLE_ADMIN = os.getenv("ENABLE_ADMIN", "true").lower() in ("true", "1", "yes")
ADMIN_KEY = os.getenv("ADMIN_KEY", "").strip() or None
ALLOW_OPEN_API = os.getenv("ALLOW_OPEN_API", "true").lower() in ("true", "1", "yes")

# FRONTEND_DIST directory: env override, else <repo>/frontend/dist (monorepo), else ./static
_backend_root = os.path.dirname(os.path.dirname(__file__))
default_dist = os.path.abspath(os.path.join(_backend_root, "..", "frontend", "dist"))
if not os.path.exists(default_dist):
    default_dist = os.path.abspath(os.path.join(_backend_root, "static"))

FRONTEND_DIST = os.getenv("FRONTEND_DIST", default_dist)

# Explicit origin list (G9: never combine * with credentials)
cors_env = os.getenv("CORS_ORIGINS", f"http://localhost:5173,http://localhost:3000,http://{lan_ip}:5173,http://{lan_ip}:{PORT}")
CORS_ORIGINS = [origin.strip() for origin in cors_env.split(",") if origin.strip() and origin.strip() != "*"]

# HTTP Basic Auth for project access control
BASIC_AUTH_ENABLED = os.getenv("BASIC_AUTH_ENABLED", "false").lower() in ("true", "1", "yes")
BASIC_AUTH_USER = os.getenv("BASIC_AUTH_USER", "team")
BASIC_AUTH_PASS = os.getenv("BASIC_AUTH_PASS", "").strip()
if BASIC_AUTH_ENABLED and not BASIC_AUTH_PASS:
    raise RuntimeError("BASIC_AUTH_ENABLED is true but BASIC_AUTH_PASS is not set.")

