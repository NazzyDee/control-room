const fs = require('fs');
const k2 = JSON.parse(fs.readFileSync('C:/Users/npwhi/Downloads/your-journey-your-tools-firebase-adminsdk-fbsvc-e2c5facd1e.json'));
let envContent = 'GOOGLE_CLIENT_EMAIL=' + k2.client_email + '\n';
envContent += 'GOOGLE_PRIVATE_KEY="' + k2.private_key.replace(/\n/g, '\\n') + '"\n';
fs.writeFileSync('.env.netlify', envContent);
