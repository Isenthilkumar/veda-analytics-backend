const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

// Load API Key securely from Vercel Environment Variables
const API_KEY = process.env.GEMINI_API_KEY;

const app = express();
const genAI = new GoogleGenerativeAI(API_KEY);

// Use a secure file-system-safe method for creating temporary storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, '/tmp/'); // Vercel's only writable directory
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Enable CORS
app.use(cors({
  origin: '*',
}));
app.use(express.json());

// Helper to prepare file for Gemini API
function fileToGenerativePart(filePath, mimeType) {
  try {
    return {
      inlineData: {
        data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
        mimeType
      },
    };
  } catch (error) {
    console.error(`Error reading file at ${filePath}:`, error);
    throw new Error('Could not read the uploaded file.');
  }
}

// Main analysis endpoint
app.post('/analyze', upload.single('report'), async (req, res) => {
  if (!API_KEY) {
      return res.status(500).json({ error: 'Server configuration error: Gemini API Key not found.' });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const { mimetype, path: tempPath } = req.file;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    // Corrected prompt to ensure valid JSON output from the model
    const prompt = `
      Analyze the attached blood report. Extract the patient's name, age, and gender.
      Then, extract the values for all available tests. If a value is a string (e.g., 'Positive', 'Negative'), keep it as a string. If it's a number, convert it to a float. If a value is not found, use null.
      
      Return a single JSON object with the following fields:
      - "name"
      - "age_sex"
      - "typhidot_igg"
      - "typhidot_igm"
      - "bilirubin_total"
      - "sgpt_alt"
      - "sgot_ast"
      - "hbsag"
      - "anti_hcv"
      - "haemoglobin"
      - "wbc_tlc"
      - "total_rbc"
      - "hct_pvc"
      - "mcv"
      - "mch"
      - "mchc"
      - "platelets"
      - "hba1c"
      - "estimated_average_glucose"
      - "fasting_glucose"
      - "total_cholesterol"
      - "hdl_cholesterol"
      - "ldl_cholesterol"
      - "triglycerides"
      - "creatinine"
      - "bun"
      - "tsh"
      - "free_t3"
      - "free_t4"
      - "vitamin_d"
      - "vitamin_b12"
      - "iron"
      - "ferritin"
      - "crp"
      - "esr"
      - "procalcitonin"
      - "ana_titer"
      - "rheumatoid_factor"
      - "testosterone"
      - "cortisol"
      - "pt_inr"
      - "ptt"
      - "d_dimer"
      - "malaria_rapid_test"
      - "typhoid_test"
      - "widal_test"
      - "dengue_ns1"
      - "dengue_igm"
      - "chikungunya_igm"
      - "tuberculosis"
      - "neutrophils"
      - "lymphocytes"
      - "monocytes"
      - "eosinophils"

      Do not include any other text or formatting outside of the JSON block.
    `;

    const imagePart = fileToGenerativePart(tempPath, mimetype);
    const result = await model.generateContent({
        contents: [{ parts: [{ text: prompt }, imagePart] }],
        generationConfig: {
             responseMimeType: "application/json"
        },
    });

    const responseText = result.response.candidates[0].content.parts[0].text;
    
    // Clean up the temporary file
    fs.unlinkSync(tempPath);
    
    // The model is now instructed to output valid JSON directly, so we can parse it.
    const parsedData = JSON.parse(responseText);
    res.json(parsedData);

  } catch (error) {
    console.error('API Error:', error);
    if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath); // Ensure file is deleted even on error
    }
    res.status(500).json({ 
        error: 'Failed to process the request due to a server error.', 
        details: error.message 
    });
  }
});

module.exports = app;
