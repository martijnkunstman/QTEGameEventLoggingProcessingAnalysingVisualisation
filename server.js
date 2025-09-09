const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const fs = require('fs');

// Serve static files from the 'public' directory
// The 'path.join' ensures the path works correctly across different operating systems
app.use(express.static(path.join(__dirname, 'client')));

// Set up a basic route for the home page
app.get('/', (req, res) => {
  res.send('Hello, you can now access static files!');
});

//make a post request endpoint /logevent that logs the event to the console
app.post('/logevent', express.json(), (req, res) => {
  console.log('Event logged:', req.body);
  //write the log to a file with the current timestamp as filename, log it to the logs directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, `${timestamp}.log`);

  // Ensure the logs directory exists
  fs.mkdir(logDir, { recursive: true }, (err) => {
    if (err) {
      console.error('Error creating logs directory:', err);
      return res.status(500).send('Internal Server Error');
    }
    const logEntry = req.body.log.map(line => `${new Date().toISOString()} | ${line}`).join('\n') + '\n';

    // Write the log entry to the file
    fs.appendFile(logFile, logEntry, (err) => {
      if (err) {
        console.error('Error writing to log file:', err);
        return res.status(500).send('Internal Server Error');
      }
      res.status(200).send('Event logged');
    });
  });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});