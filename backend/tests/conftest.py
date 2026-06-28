import os
import tempfile

# Must be set before app.core.auth is imported — keeps the FileUserStore
# used in tests away from the real data/users.json.
os.environ.setdefault("USER_STORE_FILE", os.path.join(tempfile.mkdtemp(), "users.json"))
