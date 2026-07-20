const { cert } = require("firebase-admin/app");
let privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDDpNOswziWYw8VOArAULQGdnQzW/cObm/b4PWdJegUL3EZy/V2LksB+f5Pg3tACXMZFhgratLRifucGdv677tuAiUqHTk8QWjn1syIAn0dQUDOnz+exkgVD+DgwqzNixEupqhxGL1g/fKhgeYCErh2t8Y0gVSREiAW4UIoUGmBhgFPoa/ZPje7/yrUz9zfonPzsA2doHO1IXeTR8FsvtfJeHpUpKVtlP5VStd6qbDVmPYSJgMUU/x3+XZLoHBzzu9KXHApK2FsALlv0nqCryCeJVIF1lPMwM4+iXmbm8XF0LRGJemDx+8lTZ5BNtz3xlMmJ6AIDNT1OMw3a7SIBFVbAgMBAAECgf9EvntCCAW6diFQDngQKGWYUYXe99LunDTbaLKNe4pXweZfaHpXiABa01rqAvlGRn2FuM89qPliB4zP/0Pvnz/fn4EReBSlgaLhgJc2OdVnPI4jS5aCHMMSDrw80mxrL0V2xCFelXKO6UWdBn76dpUhmAzMi2WnQMEFyAARUbEWNxCen0eOntOIHe5Qwv33rdrtJpitLsTNY3OVGjbwJu6sFLkSJgIVlm9eQq+Q3wfvNP0qTHRKfQ9TyPIF8AuNnhCAuU4D3u5J/5xzwippqFw99XkgniTF+BZ70DyAR9RI+3zgjkj+j/kNWZ5+p6NL6a2jjB+lttz5dMG5HUZz5NUCgYEA4Ix687Jp6uIEj+5wNe+8FzWhi7oMLI+VXINitXLviUq7viUb6V10oj+RJFigehhKBDbQtGwfR/M+9qZL1xDLbQiczV9Bann3sHjX3j1ZoxKBnVAh4HApR46hx0mPM14ch3/ALbpfm9jyO3OvWaEKHZCByNV2dwZ4oypL3zPl+e0CgYEA3wvrdtcl9cBeeiUqa0Y85s90s5ajWC4J92/bv7B5iALXN/Pw4oOHDM3f7fsTnct7JB8b6i+yRxKwNjjTGOh0q7D9WMJPxPEqjt0qQSbV5i6HupHPrSZYJKxqdSmGh6AAz15S6Cg+X82lNX2cZRvDTGyEnu3SavTJXa1yCgYAnGq/KwrZJTkUHH7nw2qgBzrgsUiEOnY6gRs0o1jQ6z4X0bhf3Quwt2S4Yi0qfGJ3DMByWXwHvkL/VSk6IzIbwnQBZj44f0c+9rr3BGSQEDxP9ZlgP8thterxXrUq/4lLLkgbQr9U4mcZNbi8KR84wKdtAM1RnE/xsRdBitXIGXQKBgQChDCI/9KjcAMI2v48ZVeWzYieJZEMc8GER4BpzFiEqK6LqK6DKbN2eSShe1OMdFEcdlbi6JyY6WywQeocxfOaA8ZJ7/BFMyjVIYjiYQko/oWkvNQkWpJEQKc3UOt+AHe93y0thhW1ED2AydzftaVZiYBiCCIXd5FFg6lO0QqsuEQKBgQDaWD/X0lAOkaypepygFHJp2WFe4q0ach443784+mO02dvuXRikLy8Zg1IEFP3hXdryh4SeN2o4Aats0y01Hn7i/JZjHnAHMuy1EHzBwqOM1A6hqQvqj7jSYqYhyiTwZE0gZS0x3pCGD88B2nPjY40BM5jfj3IOac03fpcsV0PM1Q==
-----END PRIVATE KEY-----`;

const parts = privateKey.split("\n");
if (parts.length === 3) {
  parts[1] = parts[1].replace(/\s+/g, "\n");
  privateKey = parts.join("\n");
}
console.log("Reformatted private key length:", privateKey.length);

try {
const credential = cert({
  projectId: "your-journey-your-tools",
  clientEmail: "firebase-adminsdk-fbsvc@your-journey-your-tools.iam.gserviceaccount.com",
  privateKey: privateKey
});
console.log("Credentials parsed correctly!");
} catch (e) {
  console.error("Parse error:", e);
}
