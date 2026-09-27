"use strict";

// Labeled corpus for the secret detector. Every credential-shaped value is
// assembled at runtime from split fragments so that no literal token pattern
// exists in the repository; otherwise GitHub push protection and every secret
// scanner pointed at this repo would flag the test data.
const join = (...parts) => parts.join("");
const alnum = (length) => "abcdefghijklmnopqrstuvwxyz0123456789".repeat(4).slice(0, length);

const positives = [
  `aws configure set aws_access_key_id ${join("AKIA", "IOSFODNN7EXAMPLE")}`,
  `export AWS_SECRET_ACCESS_KEY=${join("wJalrXUtnFEMI/K7MDENG", "/bPxRfiCYEXAMPLEKEY")}`,
  `git clone https://${join("gh", "p_", alnum(36))}@github.com/org/repo`,
  `gh auth login --with-token ${join("github", "_pat_", "11ABCDEFG0123456789_", alnum(30))}`,
  `curl -H 'PRIVATE-TOKEN: ${join("gl", "pat-", alnum(20))}' https://gitlab.example.com/api/v4/projects`,
  `slack-cli send --auth ${join("xo", "xb-", "1234567890-", alnum(12))}`,
  `curl https://api.stripe.com/v1/charges -u ${join("sk", "_live_", alnum(20))}:`,
  `curl 'https://maps.googleapis.com/maps/api/geocode/json?key=${join("AI", "za", "SyA-", alnum(31))}'`,
  `npm config set //registry.npmjs.org/:_authToken ${join("np", "m_", alnum(36))}`,
  `curl https://api.anthropic.com/v1/messages -H 'x-api-key: ${join("sk", "-ant-", "api03-", alnum(26))}'`,
  `curl -H 'Authorization: Bearer ${join("ey", "JhbGciOiJIUzI1NiJ9", ".ey", "JzdWIiOiIxMjM0NTY3ODkwIn0", ".dozjgNryP4J3jVmNHl0w5N")}' https://api.example.com`,
  `curl -H 'Authorization: Bearer ${join("9f8e7d6c5b4a3928", "1706f5e4d3c2b1a0")}' https://api.example.com/me`,
  `curl -H 'Authorization: Basic ${join("YWRtaW46", "c3VwZXJzZWNyZXQ=")}' https://jenkins.example.com`,
  `psql postgresql://app:${join("hunter2", "secret")}@db.internal:5432/orders`,
  `curl -u admin:${join("correct", "horse")} https://registry.example.com/v2/_catalog`,
  `PGPASSWORD=${join("s3cret", "Passw0rd")} psql -h db.internal -U app`,
  `mysql -h db --password=${join("Sup3r", "S3cret")} -u root`,
  `docker login --password ${join("hunter2", "hunter2")} registry.example.com`,
  `echo '{"api_key": "${join("a1b2c3d4", "e5f6g7h8")}"}' > config.json`,
  `echo '${join("-----BEGIN OPENSSH ", "PRIVATE KEY-----")}' > id_ed25519`,
  `vault login token=${join("hvs.", "CAESIabcdefghijklmnop")}`,
];

const negatives = [
  "kubectl get pods -n production",
  "kubectl get secret db-creds -n prod -o jsonpath='{.data.password}' | base64 -d",
  "kubectl create secret generic api --from-literal=password={{password}}",
  "PGPASSWORD=$DB_PASSWORD psql -h {{host}} -U app",
  'curl -H "Authorization: Bearer $TOKEN" https://api.example.com/me',
  "curl -H 'Authorization: Bearer {{token}}' https://api.example.com/me",
  'curl -H "Authorization: Bearer $(gcloud auth print-access-token)" https://example.googleapis.com',
  "psql postgresql://app:{{password}}@db.internal:5432/orders",
  "curl -u admin:$ADMIN_PASSWORD https://registry.example.com/v2/_catalog",
  "docker login --password-stdin registry.example.com < token.txt",
  "aws secretsmanager get-secret-value --secret-id prod/api/db --query SecretString",
  "kubectl apply -f secret-token-rotation.yaml",
  "gh auth token | docker login ghcr.io -u USERNAME --password-stdin",
  "vault kv get -field=password secret/prod/db",
  "ssh-keygen -t ed25519 -C 'deploy key' -f ~/.ssh/deploy",
  "git log --author=alice --since='2 weeks ago'",
  "grep -rn 'password' src/",
  "terraform apply -var token_ttl=3600",
  "openssl rand -base64 32",
  "mysql -h db -u root -p",
  "curl --token-file=/run/secrets/token https://api.example.com",
  "echo 'reset password for user alice'",
  "curl -H 'Authorization: Basic {{credentials}}' https://jenkins.example.com",
];

module.exports = [
  ...positives.map((text) => ({ text, secret: true })),
  ...negatives.map((text) => ({ text, secret: false })),
];
