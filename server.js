const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

// IMPORTANT: Replace with your actual Gemini API Key
const API_KEY = ""; // Do NOT hardcode this in a production environment.

const app = express();
const port = 3000;

const genAI = new GoogleGenerativeAI(API_KEY);
const upload = multer({ dest: 'uploads/' });

// Enable CORS for all requests. This is the fix.
app.use(cors({
  origin: '*', // Allow all origins to access the server
}));
app.use(express.json());

// Helper function to convert file to a base64-encoded object
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString("base64"),
      mimeType
    },
  };
}

// Main analysis endpoint
app.post('/analyze', upload.single('report'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    const { originalname, mimetype, path: tempPath } = req.file;

    // Use a multi-modal model (like Gemini Pro Vision) for image/PDF analysis
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

    // The prompt to extract key information from the report
    const prompt = `
      Analyze this blood report. Extract the values for the following parameters and return them as a JSON object. If a value is not found, use null.
      Parameters to find:
      - HbA1c
      - Total Cholesterol
      - HDL Cholesterol
      - Triglycerides
      - Uric Acid
      
      Example of desired JSON output:
      {
        "HbA1c": 6.2,
        "Total Cholesterol": 253,
        "HDL Cholesterol": 47,
        "Triglycerides": 344,
        "Uric Acid": 7.6
      }
    `;

    // Prepare the file for Gemini
    const imagePart = fileToGenerativePart(tempPath, mimetype);

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const jsonText = response.text().trim();

    // Clean up the temporary file
    fs.unlinkSync(tempPath);

    // Attempt to parse the JSON output from Gemini
    let parsedData;
    try {
      parsedData = JSON.parse(jsonText);
    } catch (e) {
      console.error("Failed to parse JSON from Gemini:", jsonText);
      return res.status(500).json({ error: "Could not parse report data. Please ensure the report is clear.", rawResponse: jsonText });
    }

    res.json(parsedData);

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Failed to process the request.', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
