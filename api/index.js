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

    // Updated and more specific prompt with additional fields
    const prompt = `
      Analyze the attached blood report. Extract the patient's name, age, and gender.
      Then, extract the values for all available tests. If a value is a string (e.g., 'Positive', 'Negative'), keep it as a string. If it's a number, convert it to a float. If a value is not found, use null.
      
      Extract the following fields:
      - Patient's Name (key: "name")
      - Age/Sex (key: "age_sex")
      - Typhidot IgG (key: "typhidot_igg")
      - Typhidot IgM (key: "typhidot_igm")
      - Bilirubin Total (key: "bilirubin_total")
      - SGPT (ALT) (key: "sgpt_alt")
      - SGOT (AST) (key: "sgot_ast")
      - HBsAg (key: "hbsag")
      - Anti HCV (key: "anti_hcv")
      - Haemoglobin (key: "haemoglobin")
      - WBC (TLC) (key: "wbc_tlc")
      - Total RBC (key: "total_rbc")
      - HCT (PVC) (key: "hct_pvc")
      - MCV (key: "mcv")
      - MCH (key: "mch")
      - MCHC (key: "mchc")
      - Platelets (key: "platelets")
      - HbA1c (key: "hba1c")
      - Estimated Average Glucose (key: "estimated_average_glucose")
      - Fasting Glucose (key: "fasting_glucose")
      - Total Cholesterol (key: "total_cholesterol")
      - HDL Cholesterol (key: "hdl_cholesterol")
      - LDL Cholesterol (key: "ldl_cholesterol")
      - Triglycerides (key: "triglycerides")
      - Creatinine (key: "creatinine")
      - BUN (key: "bun")
      - TSH (key: "tsh")
      - Free T3 (key: "free_t3")
      - Free T4 (key: "free_t4")
      - Vitamin D (key: "vitamin_d")
      - Vitamin B12 (key: "vitamin_b12")
      - Iron (key: "iron")
      - Ferritin (key: "ferritin")
      - CRP (key: "crp")
      - ESR (key: "esr")

      Return the data as a single JSON object. Do not include any other text or formatting outside of the JSON block.
    `;

    const imagePart = fileToGenerativePart(tempPath, mimetype);
    const result = await model.generateContent({
        contents: [{ parts: [{ text: prompt }, imagePart] }],
        generationConfig: {
            responseMimeType: "application/json",
        },
    });

    const responseText = result.response.candidates[0].content.parts[0].text;
    
    // Clean up the temporary file
    fs.unlinkSync(tempPath);

    const parsedData = JSON.parse(responseText);
    res.json(parsedData);

  } catch (error) {
    console.error('API Error:', error);
    fs.unlinkSync(tempPath); // Ensure file is deleted even on error
    res.status(500).json({ 
        error: 'Failed to process the request due to a server error.', 
        details: error.message 
    });
  }
});

module.exports = app;
