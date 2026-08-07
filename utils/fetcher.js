// ============================================
// DATA FETCHER - Updated with Smart Name Filter
// ============================================

const axios = require('axios');
const {
  normalizePhone,
  normalizeCNIC,
  extractAllNumbers,
  extractAllCNICs
} = require('./formatters');

const CONFIG = {
  BASE_API: 'https://kingdb.xyz/api.php',
  TIMEOUT: 5000,
  RETRY_COUNT: 1,
  RETRY_DELAY: 200,
  USER_AGENT: 'Mozilla/5.0 (compatible; FastSearch/1.0)'
};

const makeRequest = async (url, retries = CONFIG.RETRY_COUNT) => {
  try {
    const response = await axios.get(url, {
      timeout: CONFIG.TIMEOUT,
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate'
      },
      decompress: true
    });
    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying request... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return makeRequest(url, retries - 1);
    }
    console.error(`Request failed:`, error.message);
    return { status: false, error: error.message };
  }
};

/**
 * Find most common REAL name - IGNORES "DATA NOT RECIEVED FROM NADRA"
 */
const findMostCommonName = (records) => {
  if (!records || !Array.isArray(records) || records.length === 0) {
    return 'Unknown';
  }
  
  // Blacklist of fake/error names
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
    '-',
    'data not recieved'
  ];
  
  const validNames = records
    .map(record => record.nam)
    .filter(name => {
      if (!name) return false;
      const cleanName = name.toString().trim();
      if (cleanName.length < 2) return false;
      
      const lowerName = cleanName.toLowerCase();
      return !blacklist.some(bad => lowerName.includes(bad));
    })
    .map(name => name.toString().trim());
  
  if (validNames.length === 0) {
    // Fallback to first record's name
    return records[0]?.nam?.toString().trim() || 'Unknown';
  }
  
  // Count frequencies
  const nameCounts = {};
  validNames.forEach(name => {
    nameCounts[name] = (nameCounts[name] || 0) + 1;
  });
  
  // Find most common
  let mostCommon = validNames[0];
  let maxCount = 0;
  Object.keys(nameCounts).forEach(name => {
    if (nameCounts[name] > maxCount) {
      maxCount = nameCounts[name];
      mostCommon = name;
    }
  });
  
  return mostCommon;
};

/**
 * Find BEST address - IGNORES "no", "n/a" etc.
 */
const findBestAddress = (records) => {
  if (!records || !Array.isArray(records) || records.length === 0) {
    return 'No address available';
  }
  
  const blacklist = ['no', 'n/a', 'null', 'undefined', '-', 'na', 'no address'];
  
  let bestAddress = 'No address available';
  let maxLength = 0;
  let addressCount = 0;
  
  records.forEach(record => {
    if (record.adr && record.adr.toString().trim().length > 0) {
      const addr = record.adr.toString().trim();
      const lowerAddr = addr.toLowerCase();
      
      if (blacklist.includes(lowerAddr) || lowerAddr === 'no') {
        return;
      }
      
      addressCount++;
      if (addr.length > maxLength) {
        maxLength = addr.length;
        bestAddress = addr;
      }
    }
  });
  
  if (addressCount === 0) {
    const anyAddress = records.find(r => r.adr && r.adr.toString().trim().length > 0);
    return anyAddress ? anyAddress.adr.toString().trim() : 'No address available';
  }
  
  return bestAddress;
};

/**
 * Search by phone
 */
const searchByPhone = async (phone) => {
  try {
    const normalized = normalizePhone(phone);
    if (!normalized) return { status: false, error: 'Invalid phone number' };
    const url = `${CONFIG.BASE_API}?query=${normalized}`;
    return await makeRequest(url);
  } catch (error) {
    return { status: false, error: `Phone search failed: ${error.message}` };
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
    return await makeRequest(url);
  } catch (error) {
    return { status: false, error: `CNIC search failed: ${error.message}` };
  }
};

/**
 * Comprehensive search with smart filtering
 */
const comprehensiveSearch = async (query) => {
  const { detectType, normalizePhone, normalizeCNIC } = require('./formatters');
  
  try {
    const type = detectType(query);
    let initialResult = null;
    let allRecords = [];
    let detectedCNIC = null;
    
    if (type === 'phone') {
      initialResult = await searchByPhone(query);
    } else if (type === 'cnic') {
      initialResult = await searchByCNIC(query);
    } else {
      return { success: false, error: 'Invalid format', type: 'unknown' };
    }
    
    if (!initialResult?.status || !initialResult?.data?.data) {
      return { success: false, error: 'No data found', query, type };
    }
    
    const initialRecords = initialResult.data.data;
    if (!Array.isArray(initialRecords) || initialRecords.length === 0) {
      return { success: false, error: 'No records found', query, type };
    }
    
    allRecords = [...initialRecords];
    
    // If phone search, fetch all CNIC-linked records
    if (type === 'phone') {
      const cnis = extractAllCNICs(initialRecords);
      if (cnis.length > 0) {
        detectedCNIC = cnis[0];
        console.log(`Found CNIC: ${detectedCNIC}, fetching all records...`);
        
        const cnicResult = await searchByCNIC(detectedCNIC);
        if (cnicResult?.status && cnicResult?.data?.data) {
          const cnicRecords = cnicResult.data.data;
          if (Array.isArray(cnicRecords) && cnicRecords.length > 0) {
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
      detectedCNIC = query;
    }
    
    // Extract data with smart filtering
    const allNumbers = extractAllNumbers(allRecords);
    const allCNICs = extractAllCNICs(allRecords);
    const bestAddress = findBestAddress(allRecords);    // <-- Updated
    const mostCommonName = findMostCommonName(allRecords); // <-- Updated
    
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
        cnicFound: detectedCNIC !== null,
        filteredGarbage: allRecords.length !== initialRecords.length
      }
    };
    
  } catch (error) {
    console.error('Search error:', error);
    return { success: false, error: `Search failed: ${error.message}`, query };
  }
};

module.exports = {
  searchByPhone,
  searchByCNIC,
  comprehensiveSearch,
  makeRequest,
  CONFIG,
  findMostCommonName,
  findBestAddress
};
