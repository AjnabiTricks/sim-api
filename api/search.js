export default async function handler(req, res) {
  // Disable caching completely
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
    // 📞 PRIMARY API ONLY (PaksimsData.pro)
    // =============================================
    async function searchPrimaryAPI(query) {
      try {
        const timestamp = Date.now();
        const url = `https://paksimsdata.pro/api2.php?number=${query}&_=${timestamp}`;
        console.log(`📡 Fetching: ${url}`);
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });

        if (!response.ok) {
          console.log(`HTTP Error: ${response.status}`);
          return [];
        }

        const data = await response.json();
        console.log(`✅ Received ${Array.isArray(data) ? data.length : 0} records`);
        
        // Handle different response formats
        if (Array.isArray(data) && data.length > 0) {
          return data
            .filter(item => {
              // 🔥 FILTER: Remove garbage records
              const hasValidMobile = item.Mobile && item.Mobile !== 'N/A' && item.Mobile.toString().trim().length > 0;
              const hasValidName = item.Name && item.Name !== 'Unknown' && item.Name.toString().trim().length > 0;
              return hasValidMobile && hasValidName;
            })
            .map(item => ({
              Name: item.Name || 'Unknown',
              Cnic: item.CNIC || item.cnic || 'N/A',
              Mobile: item.Mobile || 'N/A',
              Address: item.ADDRESS || item.address || 'No address'
            }));
        } else if (data && typeof data === 'object' && data.Name) {
          // Single object response
          const item = data;
          if (item.Mobile && item.Mobile !== 'N/A' && item.Name && item.Name !== 'Unknown') {
            return [{
              Name: item.Name || 'Unknown',
              Cnic: item.CNIC || item.cnic || 'N/A',
              Mobile: item.Mobile || 'N/A',
              Address: item.ADDRESS || item.address || 'No address'
            }];
          }
        }
        
        return [];
      } catch (error) {
        console.error('API Error:', error);
        return [];
      }
    }

    // =============================================
    // 🔍 SEARCH LOGIC
    // =============================================
    let allRecords = [];
    let detectedCNIC = null;

    // First search
    let initialRecords = await searchPrimaryAPI(searchQuery);
    
    if (initialRecords.length > 0) {
      allRecords = initialRecords;
      
      // Extract CNIC from results
      const cnis = getAllCNICs(initialRecords);
      if (cnis.length > 0) {
        detectedCNIC = cnis[0];
        console.log(`📌 Found CNIC: ${detectedCNIC}`);
        
        // Get ALL numbers for this CNIC
        const cnicRecords = await searchPrimaryAPI(detectedCNIC);
        if (cnicRecords.length > 0) {
          const existingNumbers = new Set(allRecords.map(r => r.Mobile));
          cnicRecords.forEach(record => {
            if (!existingNumbers.has(record.Mobile)) {
              allRecords.push(record);
              existingNumbers.add(record.Mobile);
            }
          });
          console.log(`✅ Merged ${cnicRecords.length} records from CNIC search`);
        }
      }
    }

    // =============================================
    // 📊 PROCESS RESULTS
    // =============================================
    if (!allRecords || allRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data found. Try another number.',
        query: search
      });
    }

    // 🔥 REMOVE GARBAGE RECORDS
    const cleanedRecords = allRecords.filter(item => {
      const hasValidMobile = item.Mobile && 
                           item.Mobile !== 'N/A' && 
                           item.Mobile !== 'No address' &&
                           item.Mobile.toString().trim().length > 0;
      const hasValidCnic = item.Cnic && 
                           item.Cnic !== 'N/A' && 
                           item.Cnic.toString().trim().length > 0;
      return hasValidMobile && hasValidCnic;
    });

    console.log(`📊 Cleaned records: ${cleanedRecords.length} (from ${allRecords.length})`);

    if (cleanedRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No valid data found. Try another number.',
        query: search
      });
    }

    // Remove duplicates
    const seen = new Set();
    const uniqueData = cleanedRecords.filter(item => {
      const key = `${item.Cnic}_${item.Mobile}`;
      if (!seen.has(key)) {
        seen.add(key);
        return true;
      }
      return false;
    });

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
      telegram: "https://t.me/AZ_Tricks"
    };

    return res.status(200).json(finalResponse);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message
    });
  }
}

// =============================================
// 🔧 SMART HELPER FUNCTIONS
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
