const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve static files from the 'public' directory
// The 'path.join' ensures the path works correctly across different operating systems
app.use(express.static(path.join(__dirname, 'client')));

// Set up a basic route for the home page
app.get('/', (req, res) => {
  res.send('Hello, you can now access static files!');
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});