const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 }); // Increased cache to 10 minutes

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

// 🔥 FIX: Increased timeout and retries
const fetchData = async (url, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: 15000, // 15 seconds timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FastSearch/1.0)',
          'Accept': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      if (attempt < retries - 1) {
        const delay = (attempt + 1) * 500; // Progressive delay: 500ms, 1000ms, 1500ms
        console.log(`Retry ${attempt + 1}/${retries} for ${url} (${delay}ms delay)`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`Fetch error for ${url}:`, error.message);
        return { status: false, error: error.message };
      }
    }
  }
};

// ================================================================
// 🔥 OPTIMIZED BATCH SEARCH WITH BETTER CONCURRENCY
// ================================================================
const batchSearch = async (numbers) => {
  const BASE_API = 'https://kingdb.xyz/api.php';
  const CONCURRENCY = 20; // Process 20 numbers at a time
  const allResults = [];
  let foundCount = 0;
  let processedCount = 0;
  
  console.log(`📊 Starting batch search for ${numbers.length} numbers`);
  
  // Process in chunks to avoid overwhelming the API
  for (let i = 0; i < numbers.length; i += CONCURRENCY) {
    const chunk = numbers.slice(i, i + CONCURRENCY);
    
    // Process chunk in parallel
    const chunkPromises = chunk.map(async (number) => {
      try {
        const normalized = utils.normalizePhone(number);
        const cacheKey = normalized.toString().trim();
        
        // Check cache first
        const cached = cache.get(cacheKey);
        if (cached && cached.data) {
          processedCount++;
          return cached.data;
        }
        
        // Step 1: Search phone number
        const result = await fetchData(`${BASE_API}?query=${normalized}`);
        
        if (result && result.status === true && result.data && result.data.data && result.data.data.length > 0) {
          const records = result.data.data;
          let allRecords = [...records];
          
          // Step 2: Get CNIC and fetch all records
          const firstRecord = records[0];
          const cnic = firstRecord?.cni || null;
          
          if (cnic && cnic !== 'N/A' && cnic !== '' && cnic !== null) {
            const cnicResult = await fetchData(`${BASE_API}?query=${cnic}`);
            if (cnicResult && cnicResult.status === true && cnicResult.data && cnicResult.data.data) {
              const cnicRecords = cnicResult.data.data;
              const existingNumbers = new Set(allRecords.map(r => r.nbr));
              cnicRecords.forEach(record => {
                if (!existingNumbers.has(record.nbr)) {
                  allRecords.push(record);
                  existingNumbers.add(record.nbr);
                }
              });
            }
          }
          
          // Extract all numbers
          const allNumbers = [...new Set(allRecords.map(r => r.nbr).filter(Boolean))];
          
          // Extract best name
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
          
          const hasData = finalCnic !== 'N/A' && finalCnic !== '' && finalCnic !== null;
          const found = hasData || finalName !== 'Unknown';
          
          const resultData = {
            number: number,
            name: finalName,
            cnic: finalCnic,
            address: bestAddress,
            allNumbers: allNumbers,
            found: found
          };
          
          // Cache the result
          if (found) {
            cache.set(cacheKey, { data: resultData });
          }
          
          processedCount++;
          return resultData;
        }
        
        // No data found
        processedCount++;
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
        processedCount++;
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
    
    // Wait for all promises in this chunk
    const chunkResults = await Promise.all(chunkPromises);
    allResults.push(...chunkResults);
    
    // Update progress
    const currentFound = allResults.filter(r => r.found).length;
    console.log(`📊 Progress: ${allResults.length}/${numbers.length} (${currentFound} found)`);
    
    // Small delay between chunks to avoid rate limiting
    if (i + CONCURRENCY < numbers.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  console.log(`✅ Batch complete: ${allResults.filter(r => r.found).length}/${numbers.length} found`);
  return allResults;
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
      
      // Increased limit to 200 numbers per request
      if (numbers.length > 200) {
        return res.status(400).json({
          success: false,
          error: 'Maximum 200 numbers per batch request'
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
      
      console.log(`📊 Batch request: ${uniqueNumbers.length} unique numbers`);
      
      const results = await batchSearch(uniqueNumbers);
      
      const foundCount = results.filter(r => r.found).length;
      
      console.log(`✅ Batch response: ${foundCount} found, ${results.length - foundCount} not found (${Date.now() - startTime}ms)`);
      
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
