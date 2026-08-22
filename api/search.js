const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

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

const fetchData = async (url, retries = 2) => {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FastSearch/1.0)',
        'Accept': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return fetchData(url, retries - 1);
    }
    console.error(`Fetch error for ${url}:`, error.message);
    return { status: false, error: error.message };
  }
};

// ================================================================
// 🔥 FIXED BATCH SEARCH - Fetches ALL numbers from CNIC
// ================================================================
const batchSearch = async (numbers) => {
  const BASE_API = 'https://kingdb.xyz/api.php';
  
  // Process all numbers in parallel
  const promises = numbers.map(async (number) => {
    try {
      const normalized = utils.normalizePhone(number);
      const cacheKey = normalized.toString().trim();
      
      // Check cache first
      const cached = cache.get(cacheKey);
      if (cached && cached.data && cached.data.cnic && cached.data.cnic !== 'N/A') {
        return {
          number: number,
          name: cached.data.name || 'N/A',
          cnic: cached.data.cnic || 'N/A',
          address: cached.data.completeAddress || cached.data.address || 'N/A',
          allNumbers: cached.data.allNumbers || [number],
          found: true
        };
      }
      
      // Step 1: Initial search for the phone number
      const result = await fetchData(`${BASE_API}?query=${normalized}`);
      
      if (result && result.status === true && result.data && result.data.data && result.data.data.length > 0) {
        const records = result.data.data;
        let allRecords = [...records];
        
        // Step 2: Extract CNIC from the first record
        const firstRecord = records[0];
        const cnic = firstRecord?.cni || null;
        
        // Step 3: 🔥 IF CNIC found, fetch ALL records for that CNIC
        if (cnic && cnic !== 'N/A' && cnic !== '' && cnic !== null) {
          const cnicResult = await fetchData(`${BASE_API}?query=${cnic}`);
          if (cnicResult && cnicResult.status === true && cnicResult.data && cnicResult.data.data) {
            const cnicRecords = cnicResult.data.data;
            // Merge records, avoiding duplicates
            const existingNumbers = new Set(allRecords.map(r => r.nbr));
            cnicRecords.forEach(record => {
              if (!existingNumbers.has(record.nbr)) {
                allRecords.push(record);
                existingNumbers.add(record.nbr);
              }
            });
          }
        }
        
        // Now allRecords contains ALL numbers associated with this CNIC
        
        // Extract ALL numbers from all records
        const allNumbers = [...new Set(allRecords.map(r => r.nbr).filter(Boolean))];
        
        // Extract name (filter blacklisted names)
        const names = [...new Set(allRecords.map(r => r.nam).filter(Boolean))];
        const blacklist = [
          'data not recieved from nadra',
          'data not received from nadra',
          'not received',
          'no data',
          'unknown',
          'n/a',
          'null',
          'undefined',
          'no',
          '-'
        ];
        const validNames = names.filter(name => {
          if (!name) return false;
          const cleanName = name.toString().trim();
          if (cleanName.length < 2) return false;
          const lowerName = cleanName.toLowerCase();
          return !blacklist.some(bad => lowerName.includes(bad));
        });
        let finalName = 'Unknown';
        if (validNames.length > 0) {
          const nameCount = {};
          validNames.forEach(n => { nameCount[n] = (nameCount[n] || 0) + 1; });
          finalName = Object.keys(nameCount).reduce((a, b) => nameCount[a] > nameCount[b] ? a : b);
        } else {
          finalName = names[0] || 'Unknown';
        }
        
        // Extract CNIC
        const cnis = [...new Set(allRecords.map(r => r.cni).filter(Boolean))];
        const finalCnic = cnis[0] || 'N/A';
        
        // Extract best address
        let bestAddress = 'No address available';
        let maxLen = 0;
        const addrBlacklist = ['no', 'n/a', 'null', 'undefined', '-', 'na'];
        allRecords.forEach(record => {
          if (record.adr && record.adr.toString().trim().length > 0) {
            const addr = record.adr.toString().trim();
            const lowerAddr = addr.toLowerCase();
            if (!addrBlacklist.includes(lowerAddr) && addr.length > maxLen) {
              maxLen = addr.length;
              bestAddress = addr;
            }
          }
        });
        
        // Check if we have valid data
        const hasData = finalCnic !== 'N/A' && finalCnic !== '' && finalCnic !== null;
        const hasName = finalName !== 'Unknown' && finalName !== 'N/A';
        const found = hasData || hasName;
        
        const resultData = {
          number: number,
          name: finalName,
          cnic: finalCnic,
          address: bestAddress,
          allNumbers: allNumbers,
          found: found
        };
        
        // Cache the result if found
        if (found) {
          cache.set(cacheKey, { data: resultData });
        }
        return resultData;
      }
      
      // No data found
      return {
        number: number,
        name: 'N/A',
        cnic: 'N/A',
        address: 'N/A',
        allNumbers: [number],
        found: false
      };
      
    } catch (error) {
      console.error(`Error processing ${number}:`, error);
      return {
        number: number,
        name: 'N/A',
        cnic: 'N/A',
        address: 'N/A',
        allNumbers: [number],
        found: false,
        error: error.message
      };
    }
  });
  
  // Wait for all promises to complete
  const results_array = await Promise.all(promises);
  
  // Log summary
  const foundCount = results_array.filter(r => r.found).length;
  console.log(`✅ Batch complete: ${foundCount}/${results_array.length} found`);
  
  return results_array;
};

// ================================================================
// MAIN HANDLER
// ================================================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const startTime = Date.now();

  // ================================================================
  // BATCH ENDPOINT - POST /api/batch
  // ================================================================
  if (req.method === 'POST') {
    try {
      const { numbers } = req.body;
      
      if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Missing "numbers" array parameter',
          example: { numbers: ['923001234567', '923001234568'] }
        });
      }
      
      if (numbers.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'Maximum 100 numbers per batch request'
        });
      }
      
      const uniqueNumbers = [];
      const seen = new Set();
      for (const num of numbers) {
        const cleaned = utils.normalizePhone(num);
        if (cleaned && !seen.has(cleaned)) {
          seen.add(cleaned);
          uniqueNumbers.push(cleaned);
        }
      }
      
      if (uniqueNumbers.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid numbers provided'
        });
      }
      
      console.log(`📊 Batch request: ${uniqueNumbers.length} numbers`);
      
      const results = await batchSearch(uniqueNumbers);
      
      const foundCount = results.filter(r => r.found).length;
      
      console.log(`✅ Batch response: ${foundCount} found, ${results.length - foundCount} not found`);
      
      return res.status(200).json({
        success: true,
        total: results.length,
        found: foundCount,
        notFound: results.length - foundCount,
        results: results,
        responseTime: `${Date.now() - startTime}ms`
      });
      
    } catch (error) {
      console.error('Batch error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  // ================================================================
  // SINGLE SEARCH ENDPOINT - GET /api/search
  // ================================================================
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({
      success: false,
      error: 'Missing "query" parameter',
      example: '/api/search?query=03329457632'
    });
  }

  try {
    const cacheKey = query.toString().trim();
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        ...cached,
        cached: true,
        responseTime: `${Date.now() - startTime}ms`
      });
    }

    const type = utils.detectType(query);
    const BASE_API = 'https://kingdb.xyz/api.php';
    let allRecords = [];
    let cnicFound = null;

    if (type === 'phone') {
      const normalized = utils.normalizePhone(query);
      const result = await fetchData(`${BASE_API}?query=${normalized}`);
      if (result.status && result.data && result.data.data) {
        allRecords = [...result.data.data];
        if (allRecords.length > 0 && allRecords[0].cni) {
          cnicFound = allRecords[0].cni;
        }
      }
    } else if (type === 'cnic') {
      const normalized = utils.normalizeCNIC(query);
      const result = await fetchData(`${BASE_API}?query=${normalized}`);
      if (result.status && result.data && result.data.data) {
        allRecords = [...result.data.data];
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid format. Use phone number or CNIC.'
      });
    }

    if (cnicFound && type === 'phone') {
      const cnicResult = await fetchData(`${BASE_API}?query=${cnicFound}`);
      if (cnicResult.status && cnicResult.data && cnicResult.data.data) {
        const cnicRecords = cnicResult.data.data;
        const existingNbrs = new Set(allRecords.map(r => r.nbr));
        cnicRecords.forEach(record => {
          if (!existingNbrs.has(record.nbr)) {
            allRecords.push(record);
            existingNbrs.add(record.nbr);
          }
        });
      }
    }

    if (allRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data found',
        query: query
      });
    }

    const names = [...new Set(allRecords.map(r => r.nam).filter(Boolean))];
    const blacklist = [
      'data not recieved from nadra',
      'data not received from nadra',
      'not received',
      'no data',
      'unknown',
      'n/a',
      'null',
      'undefined',
      'no',
      '-'
    ];

    const validNames = names.filter(name => {
      if (!name) return false;
      const cleanName = name.toString().trim();
      if (cleanName.length < 2) return false;
      const lowerName = cleanName.toLowerCase();
      return !blacklist.some(bad => lowerName.includes(bad));
    });

    let finalName = 'Unknown';
    if (validNames.length > 0) {
      const nameCount = {};
      validNames.forEach(n => {
        nameCount[n] = (nameCount[n] || 0) + 1;
      });
      finalName = Object.keys(nameCount).reduce((a, b) => 
        nameCount[a] > nameCount[b] ? a : b
      );
    } else {
      finalName = names[0] || 'Unknown';
    }

    const numbers = [...new Set(allRecords.map(r => r.nbr).filter(Boolean))];
    const cnis = [...new Set(allRecords.map(r => r.cni).filter(Boolean))];
    
    let bestAddress = 'No address available';
    let maxLen = 0;
    const addrBlacklist = ['no', 'n/a', 'null', 'undefined', '-', 'na'];
    allRecords.forEach(record => {
      if (record.adr && record.adr.toString().trim().length > 0) {
        const addr = record.adr.toString().trim();
        const lowerAddr = addr.toLowerCase();
        if (!addrBlacklist.includes(lowerAddr) && addr.length > maxLen) {
          maxLen = addr.length;
          bestAddress = addr;
        }
      }
    });

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
