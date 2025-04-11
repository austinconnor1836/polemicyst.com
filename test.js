fetch("http://host.docker.internal:3001/api/ping")
  .then(res => res.text())
  .then(text => console.log("✅ Got:", text))
  .catch(err => console.error("❌ Failed:", err));
