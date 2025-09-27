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
  let tempPath = null; // Declare tempPath outside try/catch for cleanup

  if (!API_KEY) {
      return res.status(500).json({ error: 'Server configuration error: Gemini API Key not found.' });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  tempPath = req.file.path; // Assign tempPath here

  try {
    const { mimetype } = req.file;
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    // --- CRITICAL FIX: Expanded, normalized list for accurate FE parsing ---
    const prompt = `
      Analyze the attached blood report. Extract the patient details and the measured results for ALL medical tests listed below. 
      If a value is a string (e.g., 'Positive', 'Negative'), keep it as a string. If it's a number, convert it to a float. If a value is not found, use null.
      
      Return a single JSON object with the following mandatory keys. Ensure the keys and casing match exactly:

      - "name"
      - "age_sex"
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
      - "bilirubin_total"
      - "sgpt_alt"
      - "sgot_ast"
      - "typhidot_igg"
      - "typhidot_igm"
      - "hbsag"
      - "anti_hcv"
      - "creatinine"
      - "bun"
      - "uric_acid"
      - "tsh"
      - "crp"
      - "esr"
      - "free_t3"
      - "free_t4"
      - "vitamin_d"
      - "vitamin_b12"
      - "iron"
      - "ferritin"
      - "total_cholesterol"
      - "hdl_cholesterol"
      - "ldl_cholesterol"
      - "triglycerides"
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
    
    // FIX: Removed the unsupported responseMimeType parameter
    const result = await model.generateContent({
        contents: [{ parts: [{ text: prompt }, imagePart] }],
    });

    const responseText = result.response.candidates[0].content.parts[0].text;
    
    // Attempt to parse the JSON output from Gemini.
    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
    } catch (e) {
      console.error("Failed to parse JSON from Gemini:", responseText);
      // Fallback: Use a regex to extract JSON if the model wraps it in markdown
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
          try {
              parsedData = JSON.parse(jsonMatch[1].trim());
          } catch (e2) {
              return res.status(500).json({
                  error: "Could not parse report data. Gemini may not have returned valid JSON (Fallback Failed).",
                  rawResponse: responseText
              });
          }
      } else {
          return res.status(500).json({
              error: "Could not parse report data. Gemini may not have returned valid JSON (No JSON Block Found).",
              rawResponse: responseText
          });
      }
    }

    res.json(parsedData);

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
        error: 'Failed to process the request due to a server error.', 
        details: error.message 
    });
  } finally {
    // Ensure file is deleted even on success or failure
    if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath); 
    }
  }
});

module.exports = app;
