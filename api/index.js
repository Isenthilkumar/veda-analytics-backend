const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const cors = require('cors');

// IMPORTANT: Your Gemini API Key is loaded securely from Vercel Environment Variables
const API_KEY = process.env.GEMINI_API_KEY;

const app = express();

// Initialize GoogleGenerativeAI with the secured API Key
const genAI = new GoogleGenerativeAI(API_KEY);

// FIX: Configure Multer to use the Vercel-safe /tmp directory.
// Vercel serverless functions can only write to /tmp.
const upload = multer({ dest: '/tmp/' });

// Enable CORS for all requests. (Addresses the CORS error).
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
    if (!API_KEY) {
        // Essential check for the API key in the Vercel environment
        return res.status(500).json({ error: 'Server configuration error: Gemini API Key not found. Check Vercel Environment Variables.' });
    }
    
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    const { originalname, mimetype, path: tempPath } = req.file;

    // Use a multi-modal model (Gemini 1.5 Pro) for image/PDF analysis
    //const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    // UPDATED PROMPT: Extract ALL key metrics
    const prompt = `
      Analyze this blood report thoroughly. Extract ALL key medical parameters: HbA1c, Total Cholesterol, HDL Cholesterol, Triglycerides, Uric Acid, Creatinine, Hemoglobin, and TSH. If any parameter is not found, use null.
      
      Return the data as a single JSON object where each parameter name is a key and its value is the measured value as a number. Only return the final data values, not the units, as the frontend handles the units and ranges.

      Example of desired JSON output:
      {
        "HbA1c": 6.2,
        "Total Cholesterol": 253,
        "HDL Cholesterol": 47,
        "Triglycerides": 344,
        "Uric Acid": 7.6,
        "Creatinine": 0.9,
        "Hemoglobin": 14.5,
        "TSH": null
      }
    `;

    // Prepare the file for Gemini
    const imagePart = fileToGenerativePart(tempPath, mimetype);

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    
    // Clean up the temporary file immediately after use.
    fs.unlinkSync(tempPath);

    // Attempt to extract text between ```json and ``` for robust parsing
    const jsonMatch = response.text.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1].trim() : response.text.trim();

    // Attempt to parse the JSON output from Gemini
    let parsedData;
    try {
      parsedData = JSON.parse(jsonText);
    } catch (e) {
      console.error("Failed to parse JSON from Gemini:", jsonText);
      // Return a 500 error but include the raw response text for debugging
      return res.status(500).json({ 
        error: "Could not parse report data. Gemini may not have returned valid JSON.", 
        rawResponse: jsonText 
      });
    }

    res.json(parsedData);

  } catch (error) {
    console.error('API Error:', error);
    // Include the error details in the response for better debugging
    res.status(500).json({ error: 'Failed to process the request.', details: error.message });
  }
});

// FIX: Export the app for Vercel to use as the serverless function handler.
module.exports = app;