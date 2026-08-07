// ============================================
// DATA FETCHER - Handles all API calls
// With retry, timeout, and error handling
// ============================================

const axios = require('axios');
const {
  normalizePhone,
  normalizeCNIC,
  extractAllNumbers,
  extractAllCNICs,
  findBestAddress,
  findMostCommonName
} = require('./formatters');

// Configuration
const CONFIG = {
  BASE_API: 'https://kingdb.xyz/api.php',
  TIMEOUT: 5000, // 5 seconds
  RETRY_COUNT: 1,
  RETRY_DELAY: 200, // 200ms
  USER_AGENT: 'Mozilla/5.0 (compatible; FastSearch/1.0)'
};

/**
 * Make API request with retry logic
 */
const makeRequest = async (url, retries = CONFIG.RETRY_COUNT) => {
  try {
    const response = await axios.get(url, {
      timeout: CONFIG.TIMEOUT,
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate'
      },
      // Enable gzip decompression for faster responses
      decompress: true
    });
    
    return response.data;
  } catch (error) {
    // If retries left, wait and try again
    if (retries > 0) {
      console.log(`Retrying request... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return makeRequest(url, retries - 1);
    }
    
    // Log error but don't throw
    console.error(`Request failed for ${url}:`, error.message);
    return {
      status: false,
      error: error.message,
      code: error.code || 'UNKNOWN'
    };
  }
};

/**
 * Search by phone number
 */
const searchByPhone = async (phone) => {
  try {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      return { status: false, error: 'Invalid phone number' };
    }
    
    const url = `${CONFIG.BASE_API}?query=${normalized}`;
    const result = await makeRequest(url);
    
    return result;
  } catch (error) {
    return {
      status: false,
      error: `Phone search failed: ${error.message}`
    };
  }
};

/**
 * Search by CNIC
 */
const searchByCNIC = async (cnic) => {
  try {
    const normalized = normalizeCNIC(cnic);
    if (!normalized || normalized.length !== 13) {
      return { status: false, error: 'Invalid CNIC (must be 13 digits)' };
    }
    
    const url = `${CONFIG.BASE_API}?query=${normalized}`;
    const result = await makeRequest(url);
    
    return result;
  } catch (error) {
    return {
      status: false,
      error: `CNIC search failed: ${error.message}`
    };
  }
};

/**
 * Perform comprehensive search
 * If phone is searched, automatically finds CNIC and all linked numbers
 */
const comprehensiveSearch = async (query) => {
  const { detectType, normalizePhone, normalizeCNIC } = require('./formatters');
  
  try {
    // Step 1: Detect query type
    const type = detectType(query);
    let initialResult = null;
    let allRecords = [];
    let detectedCNIC = null;
    
    // Step 2: Initial search based on type
    if (type === 'phone') {
      initialResult = await searchByPhone(query);
    } else if (type === 'cnic') {
      initialResult = await searchByCNIC(query);
    } else {
      return {
        success: false,
        error: 'Invalid query format. Please provide a phone number or CNIC.',
        type: 'unknown'
      };
    }
    
    // Step 3: Check if we got results
    if (!initialResult || !initialResult.status || 
        !initialResult.data || !initialResult.data.data) {
      return {
        success: false,
        error: 'No data found for the provided query',
        query: query,
        type: type
      };
    }
    
    // Step 4: Extract records from initial search
    const initialRecords = initialResult.data.data;
    if (!Array.isArray(initialRecords) || initialRecords.length === 0) {
      return {
        success: false,
        error: 'No records found',
        query: query,
        type: type
      };
    }
    
    // Start with initial records
    allRecords = [...initialRecords];
    
    // Step 5: If searching by phone, try to find all records by CNIC
    if (type === 'phone') {
      // Extract CNIC from initial records
      const cnis = extractAllCNICs(initialRecords);
      if (cnis.length > 0) {
        detectedCNIC = cnis[0]; // Use first CNIC found
        console.log(`Found CNIC: ${detectedCNIC}, fetching all records...`);
        
        // Search by CNIC to get ALL linked numbers
        const cnicResult = await searchByCNIC(detectedCNIC);
        if (cnicResult && cnicResult.status && 
            cnicResult.data && cnicResult.data.data) {
          
          const cnicRecords = cnicResult.data.data;
          if (Array.isArray(cnicRecords) && cnicRecords.length > 0) {
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
      }
    } else if (type === 'cnic') {
      // If searching by CNIC, we already have all records
      detectedCNIC = query;
    }
    
    // Step 6: Process and format the results
    const allNumbers = extractAllNumbers(allRecords);
    const allCNICs = extractAllCNICs(allRecords);
    const bestAddress = findBestAddress(allRecords);
    const mostCommonName = findMostCommonName(allRecords);
    
    return {
      success: true,
      type: type,
      query: query,
      data: {
        name: mostCommonName,
        allNumbers: allNumbers,
        cnic: detectedCNIC || (allCNICs.length > 0 ? allCNICs[0] : null),
        allCNICs: allCNICs,
        completeAddress: bestAddress,
        totalRecords: allRecords.length,
        records: allRecords
      },
      meta: {
        queryType: type,
        searchCompleted: true,
        cnicFound: detectedCNIC !== null
      }
    };
    
  } catch (error) {
    console.error('Comprehensive search error:', error);
    return {
      success: false,
      error: `Search failed: ${error.message}`,
      query: query
    };
  }
};

/**
 * Quick search - just get basic info without CNIC linking
 */
const quickSearch = async (query) => {
  const { detectType } = require('./formatters');
  
  try {
    const type = detectType(query);
    let result = null;
    
    if (type === 'phone') {
      result = await searchByPhone(query);
    } else if (type === 'cnic') {
      result = await searchByCNIC(query);
    } else {
      return {
        success: false,
        error: 'Invalid query format'
      };
    }
    
    if (!result || !result.status || !result.data || !result.data.data) {
      return {
        success: false,
        error: 'No data found'
      };
    }
    
    const records = result.data.data;
    return {
      success: true,
      type: type,
      data: {
        name: findMostCommonName(records),
        numbers: extractAllNumbers(records),
        cnic: extractAllCNICs(records)[0] || null,
        address: findBestAddress(records),
        total: records.length,
        records: records
      }
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Quick search failed: ${error.message}`
    };
  }
};

module.exports = {
  searchByPhone,
  searchByCNIC,
  comprehensiveSearch,
  quickSearch,
  makeRequest,
  CONFIG
};
