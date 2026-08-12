try {
  process.loadEnvFile();
} catch {
  // no .env file present (e.g. production) - real environment variables are used instead
}
