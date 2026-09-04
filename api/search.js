export default async function handler(req, res) {
  // Disable caching
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { search } = req.query;

  if (!search) {
    return res.status(400).json({
      success: false,
      error: 'Please provide "search" parameter (Phone number or CNIC)'
    });
  }

  // --- CLEAN INPUT ---
  let cleanInput = search.trim()
    .replace(/\s/g, '')
    .replace(/-/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\+/g, '');

  let isCNIC = /^[0-9]{13}$/.test(cleanInput);
  let phoneNumber = cleanInput;

  if (!isCNIC) {
    if (phoneNumber.startsWith('923')) phoneNumber = phoneNumber.substring(3);
    else if (phoneNumber.startsWith('92')) phoneNumber = phoneNumber.substring(2);
    if (/^3[0-9]{9}$/.test(phoneNumber)) phoneNumber = '0' + phoneNumber;
    else if (/^[0-9]{10}$/.test(phoneNumber) && phoneNumber.startsWith('3')) phoneNumber = '0' + phoneNumber;
    
    if (!/^03[0-9]{9}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number. Must be 11 digits starting with 03'
      });
    }
  }

  try {
    const searchQuery = isCNIC ? cleanInput : phoneNumber;
    console.log(`🔍 Searching: ${isCNIC ? 'CNIC' : 'Phone'}: ${searchQuery}`);

    // =============================================
    // 📞 FAST API CALL (5 seconds timeout)
    // =============================================
    async function callAPI(query, timeoutMs = 5000) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const timestamp = Date.now() + Math.random() * 1000;
        const url = `https://paksimsdata.pro/api2.php?number=${query}&_=${timestamp}`;
        console.log(`📡 Fetching: ${url}`);
        
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Accept': 'application/json'
          }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.log(`HTTP Error: ${response.status}`);
          return { success: false, data: [] };
        }

        const data = await response.json();
        console.log(`✅ Received ${Array.isArray(data) ? data.length : 0} records`);
        
        // Validate data
        let validRecords = [];
        if (Array.isArray(data) && data.length > 0) {
          validRecords = data.filter(item => {
            const hasMobile = item.Mobile && item.Mobile !== 'N/A' && item.Mobile.toString().trim().length > 0;
            const hasName = item.Name && item.Name !== 'Unknown' && item.Name.toString().trim().length > 0;
            const hasCnic = item.CNIC && item.CNIC !== 'N/A' && item.CNIC.toString().trim().length >= 13;
            return hasMobile && hasName && hasCnic;
          });
        } else if (data && typeof data === 'object' && data.Name && data.Mobile) {
          const item = data;
          if (item.Mobile && item.Mobile !== 'N/A' && item.Name && item.Name !== 'Unknown') {
            validRecords = [{
              Name: item.Name || 'Unknown',
              Cnic: item.CNIC || 'N/A',
              Mobile: item.Mobile || 'N/A',
              Address: item.ADDRESS || item.address || 'No address'
            }];
          }
        }

        if (validRecords.length > 0) {
          return { 
            success: true, 
            data: validRecords.map(item => ({
              Name: item.Name || 'Unknown',
              Cnic: item.CNIC || 'N/A',
              Mobile: item.Mobile || 'N/A',
              Address: item.ADDRESS || item.address || 'No address'
            }))
          };
        }
        
        return { success: false, data: [], reason: 'No valid records' };
      } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          console.log('⏰ Request timeout (5s)');
          return { success: false, data: [], error: 'timeout' };
        }
        console.error('API Error:', error);
        return { success: false, data: [], error: error.message };
      }
    }

    // =============================================
    // 🔍 SEARCH WITH FAST RETRY (3 retries, short delays)
    // =============================================
    async function searchWithFastRetry(query, maxRetries = 3) {
      let lastResult = null;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        console.log(`🔄 Attempt ${attempt + 1}/${maxRetries + 1} for ${query}`);
        
        const result = await callAPI(query, 5000); // 5s timeout
        
        if (result.success && result.data.length > 0) {
          console.log(`✅ Success on attempt ${attempt + 1}`);
          return result.data;
        }
        
        if (attempt < maxRetries) {
          // Fast backoff: 500ms, 1000ms, 1500ms
          const delay = (attempt + 1) * 500;
          console.log(`⏳ Waiting ${delay}ms before retry ${attempt + 2}...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        lastResult = result;
      }
      
      console.log(`❌ All ${maxRetries + 1} attempts failed for ${query}`);
      return [];
    }

    // =============================================
    // 🔍 SEARCH LOGIC
    // =============================================
    let allRecords = [];
    let detectedCNIC = null;

    // First search with fast retry
    let initialRecords = await searchWithFastRetry(searchQuery, 3);
    
    if (initialRecords.length > 0) {
      allRecords = initialRecords;
      
      // Extract CNIC from results
      const cnis = getAllCNICs(initialRecords);
      if (cnis.length > 0) {
        detectedCNIC = cnis[0];
        console.log(`📌 Found CNIC: ${detectedCNIC}`);
        
        // Get ALL numbers for this CNIC with fast retry
        const cnicRecords = await searchWithFastRetry(detectedCNIC, 3);
        if (cnicRecords.length > 0) {
          const existingNumbers = new Set(allRecords.map(r => r.Mobile));
          cnicRecords.forEach(record => {
            if (!existingNumbers.has(record.Mobile)) {
              allRecords.push(record);
              existingNumbers.add(record.Mobile);
            }
          });
          console.log(`✅ Merged ${cnicRecords.length} records from CNIC search`);
        } else {
          console.log(`⚠️ CNIC search failed after retries, using initial data only`);
        }
      }
    } else {
      console.log(`❌ Initial search failed after retries, returning 404`);
    }

    // =============================================
    // 📊 PROCESS RESULTS
    // =============================================
    if (!allRecords || allRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data found. Try another number.',
        query: search,
        timestamp: Date.now()
      });
    }

    // Remove duplicates
    const seen = new Set();
    const uniqueData = allRecords.filter(item => {
      const key = `${item.Cnic}_${item.Mobile}`;
      if (!seen.has(key)) {
        seen.add(key);
        return true;
      }
      return false;
    });

    console.log(`📊 Total unique records: ${uniqueData.length}`);

    // =============================================
    // 🔥 SMART FILTERS
    // =============================================
    const finalName = getSmartName(uniqueData);
    const bestAddress = getSmartAddress(uniqueData);
    const allNumbers = getAllNumbers(uniqueData);
    const allCNICs = getAllCNICs(uniqueData);

    // =============================================
    // 📦 FINAL RESPONSE
    // =============================================
    const finalResponse = {
      success: true,
      query: isCNIC ? cleanInput : phoneNumber,
      detectedType: isCNIC ? 'cnic' : 'phone',
      data: {
        name: finalName,
        allNumbers: allNumbers.length > 0 ? allNumbers : ['No numbers found'],
        cnic: allCNICs[0] || null,
        allCNICs: allCNICs,
        completeAddress: bestAddress,
        totalRecords: uniqueData.length,
        records: uniqueData.map(item => ({
          name: item.Name,
          cnic: item.Cnic,
          number: item.Mobile,
          address: item.Address
        }))
      },
      credit: "AZ Tricks",
      telegram: "https://t.me/AZ_Tricks",
      _timestamp: Date.now()
    };

    return res.status(200).json(finalResponse);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message,
      timestamp: Date.now()
    });
  }
}

// =============================================
// 🔧 SMART HELPER FUNCTIONS (same as before)
// =============================================
function getSmartName(records) {
  const garbage = [
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
    'cnic',
    'mobile',
    'address',
    'search',
    'not found'
  ];
  
  const names = records
    .map(r => r.Name)
    .filter(n => n && n.toString().trim().length > 0)
    .map(n => n.toString().trim());
  
  if (names.length === 0) return 'Unknown';
  
  const validNames = names.filter(name => {
    const lower = name.toLowerCase();
    return !garbage.some(g => lower.includes(g));
  });
  
  if (validNames.length === 0) {
    return names[0];
  }
  
  const nameCount = {};
  validNames.forEach(name => {
    nameCount[name] = (nameCount[name] || 0) + 1;
  });
  
  let mostCommon = validNames[0];
  let maxCount = 0;
  Object.keys(nameCount).forEach(name => {
    if (nameCount[name] > maxCount) {
      maxCount = nameCount[name];
      mostCommon = name;
    }
  });
  
  return mostCommon;
}

function getSmartAddress(records) {
  const garbage = ['no', 'n/a', 'null', 'undefined', '-', 'na', 'no address', 'none', 'nill'];
  
  let bestAddress = 'No address available';
  let maxLength = 0;
  
  records.forEach(record => {
    if (record.Address && record.Address.toString().trim().length > 0) {
      const addr = record.Address.toString().trim();
      const lower = addr.toLowerCase();
      
      if (garbage.includes(lower)) return;
      
      if (addr.length > maxLength) {
        maxLength = addr.length;
        bestAddress = addr;
      }
    }
  });
  
  return bestAddress;
}

function getAllNumbers(records) {
  const numbers = records
    .map(r => r.Mobile)
    .filter(n => n && n.toString().trim().length > 0)
    .map(n => n.toString().trim());
  return [...new Set(numbers)];
}

function getAllCNICs(records) {
  const cnis = records
    .map(r => r.Cnic)
    .filter(c => c && c.toString().trim().length > 0)
    .map(c => c.toString().trim())
    .filter(c => c.length >= 13);
  return [...new Set(cnis)];
      }
