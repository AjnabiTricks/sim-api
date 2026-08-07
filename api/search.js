const axios = require('axios');
const NodeCache = require('node-cache');

// Cache setup - 5 minutes TTL for fast responses
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Formatting utilities - FAST
const utils = {
  normalizePhone: (input) => {
    let cleaned = input.toString().replace(/[^0-9+]/g, '');
    if (cleaned.startsWith('+92')) return cleaned.substring(1);
    if (cleaned.startsWith('0092')) return cleaned.substring(4);
    if (cleaned.startsWith('92')) return cleaned;
    if (cleaned.startsWith('0')) return '92' + cleaned.substring(1);
    if (cleaned.length === 10 && cleaned.startsWith('3')) return '92' + cleaned;
    return cleaned;
  },
  
  normalizeCNIC: (input) => {
    let cleaned = input.toString().replace(/[^0-9]/g, '');
    if (cleaned.length === 13) return cleaned;
    if (cleaned.length === 12) return '0' + cleaned;
    return cleaned;
  },
  
  detectType: (input) => {
    const cleaned = input.toString().replace(/[^0-9+]/g, '');
    const numeric = cleaned.replace(/[^0-9]/g, '');
    if (numeric.length === 13 && !cleaned.includes('+')) return 'cnic';
    if (numeric.length >= 10 && numeric.length <= 12) return 'phone';
    if (cleaned.includes('+')) return 'phone';
    return 'unknown';
  }
};

// API Fetcher with timeout and retry
const fetchData = async (url, retries = 1) => {
  try {
    const response = await axios.get(url, {
      timeout: 5000, // 5 second timeout for FAST response
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FastSearch/1.0)',
        'Accept': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return fetchData(url, retries - 1);
    }
    return { status: false, error: error.message };
  }
};

// Main handler - FAST response
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { query } = req.query;
  if (!query) {
    return res.status(400).json({
      success: false,
      error: 'Missing "query" parameter',
      example: '/api/search?query=03329457632'
    });
  }

  const startTime = Date.now();
  
  try {
    // Check cache FIRST for SPEED
    const cacheKey = query.toString().trim();
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('Cache hit for:', query);
      return res.status(200).json({
        ...cached,
        cached: true,
        responseTime: `${Date.now() - startTime}ms`
      });
    }

    // Detect type FAST
    const type = utils.detectType(query);
    console.log(`Searching: ${query} (${type})`);

    const BASE_API = 'https://kingdb.xyz/api.php';
    let initialData = null;
    let allRecords = [];
    let cnicFound = null;

    // Step 1: Initial search
    if (type === 'phone') {
      const normalized = utils.normalizePhone(query);
      const result = await fetchData(`${BASE_API}?query=${normalized}`);
      if (result.status && result.data && result.data.data) {
        initialData = result.data.data;
        allRecords = [...initialData];
        if (initialData.length > 0 && initialData[0].cni) {
          cnicFound = initialData[0].cni;
        }
      }
    } else if (type === 'cnic') {
      const normalized = utils.normalizeCNIC(query);
      const result = await fetchData(`${BASE_API}?query=${normalized}`);
      if (result.status && result.data && result.data.data) {
        initialData = result.data.data;
        allRecords = [...initialData];
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid format. Use phone number or CNIC.'
      });
    }

    // Step 2: If CNIC found, fetch ALL records (parallel for SPEED)
    if (cnicFound && type === 'phone') {
      const cnicResult = await fetchData(`${BASE_API}?query=${cnicFound}`);
      if (cnicResult.status && cnicResult.data && cnicResult.data.data) {
        const cnicRecords = cnicResult.data.data;
        // Merge unique records FAST
        const existingNbrs = new Set(allRecords.map(r => r.nbr));
        cnicRecords.forEach(record => {
          if (!existingNbrs.has(record.nbr)) {
            allRecords.push(record);
            existingNbrs.add(record.nbr);
          }
        });
      }
    }

    // Step 3: Process results FAST
    if (allRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data found',
        query: query
      });
    }

    // Extract data efficiently
    const names = [...new Set(allRecords.map(r => r.nam).filter(Boolean))];
    const numbers = [...new Set(allRecords.map(r => r.nbr).filter(Boolean))];
    const cnis = [...new Set(allRecords.map(r => r.cni).filter(Boolean))];
    
    // Find BEST (longest) address
    let bestAddress = 'No address available';
    let maxLen = 0;
    allRecords.forEach(record => {
      if (record.adr && record.adr.length > maxLen) {
        maxLen = record.adr.length;
        bestAddress = record.adr;
      }
    });

    // Find most common name
    let finalName = names[0] || 'Unknown';
    if (names.length > 1) {
      const nameCount = {};
      names.forEach(n => nameCount[n] = (nameCount[n] || 0) + 1);
      finalName = Object.keys(nameCount).reduce((a, b) => nameCount[a] > nameCount[b] ? a : b);
    }

    // Prepare response
    const response = {
      success: true,
      query: query,
      detectedType: type,
      data: {
        name: finalName,
        allNumbers: numbers,
        cnic: cnis[0] || null,
        completeAddress: bestAddress,
        totalRecords: allRecords.length,
        records: allRecords
      },
      responseTime: `${Date.now() - startTime}ms`
    };

    // Cache the response
    cache.set(cacheKey, response);

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
};
