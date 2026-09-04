export default async function handler(req, res) {
  // Disable caching for this API
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
  let rawInput = search.trim();
  let cleanInput = rawInput
    .replace(/\s/g, '')
    .replace(/-/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\+/g, '');

  console.log(`🔍 Raw: ${rawInput}, Cleaned: ${cleanInput}`);

  let isCNIC = false;
  let queryForAPI = cleanInput;

  // Check CNIC (13 digits)
  if (/^[0-9]{13}$/.test(cleanInput)) {
    isCNIC = true;
    queryForAPI = cleanInput;
    console.log(`✅ Detected CNIC: ${queryForAPI}`);
  } 
  // Check Phone Number
  else {
    let phoneNumber = cleanInput;

    if (phoneNumber.startsWith('923')) {
      phoneNumber = phoneNumber.substring(3);
    } else if (phoneNumber.startsWith('92')) {
      phoneNumber = phoneNumber.substring(2);
    }

    if (/^3[0-9]{9}$/.test(phoneNumber)) {
      phoneNumber = '0' + phoneNumber;
    }

    if (!/^03[0-9]{9}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format.',
        supportedFormats: [
          '03XXXXXXXXX (11 digits)',
          '3XXXXXXXXX (10 digits)',
          '923XXXXXXXXX (12 digits)',
          '+923XXXXXXXXX',
          '00923XXXXXXXXX'
        ],
        example: '03479876199 or 923479876199'
      });
    }

    queryForAPI = phoneNumber;
    console.log(`✅ Detected Phone: ${queryForAPI}`);
  }

  try {
    // =============================================
    // 📞 PRIMARY API: PaksimsData.pro (WORKING)
    // =============================================
    async function searchPaksimsData(query) {
      try {
        const cacheBuster = Date.now();
        const url = `https://paksimsdata.pro/api2.php?number=${query}&_=${cacheBuster}`;
        console.log(`📡 [Primary] Fetching: ${url}`);
        
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
        
        if (Array.isArray(data) && data.length > 0) {
          return data.map(item => ({
            Name: item.Name || item.name || 'Unknown',
            Cnic: item.CNIC || item.cnic || 'N/A',
            Mobile: item.Mobile || item.mobile || 'N/A',
            Address: item.ADDRESS || item.address || 'No address'
          }));
        } else if (data && typeof data === 'object' && data.Name) {
          return [{
            Name: data.Name || data.name || 'Unknown',
            Cnic: data.CNIC || data.cnic || 'N/A',
            Mobile: data.Mobile || data.mobile || 'N/A',
            Address: data.ADDRESS || data.address || 'No address'
          }];
        }
        
        return [];
      } catch (error) {
        console.error('Primary API error:', error);
        return [];
      }
    }

    // =============================================
    // 📞 SECONDARY API: PaksimDatabases
    // =============================================
    async function searchPaksimDatabases(query) {
      try {
        const url = 'https://paksimdatabases.com/numberDetails.php';
        console.log(`📡 [Secondary] Fetching: ${query}`);
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'host': 'paksimdatabases.com',
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
            'origin': 'https://paksimdatabases.com',
            'referer': 'https://paksimdatabases.com/',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          },
          body: new URLSearchParams({
            numberCnic: query,
            searchNumber: ''
          })
        });

        if (!response.ok) {
          console.log(`HTTP Error: ${response.status}`);
          return [];
        }

        const html = await response.text();
        console.log(`📄 HTML Length: ${html.length}`);
        
        if (html.includes('No record found') || html.includes('No data found')) {
          console.log('⚠️ No record found');
          return [];
        }
        
        const parsed = parsePaksimDatabasesHTML(html);
        console.log(`✅ Parsed ${parsed.length} records`);
        return parsed;
        
      } catch (error) {
        console.error('Secondary API error:', error);
        return [];
      }
    }

    // =============================================
    // 🔍 SEARCH LOGIC
    // =============================================
    let allRecords = [];
    let detectedCNIC = null;

    // ALWAYS use Primary API first
    let initialRecords = await searchPaksimsData(queryForAPI);
    
    if (initialRecords.length > 0) {
      allRecords = initialRecords;
      
      const cnis = getAllCNICs(initialRecords);
      if (cnis.length > 0) {
        detectedCNIC = cnis[0];
        console.log(`📌 Found CNIC: ${detectedCNIC}`);
        
        const cnicRecords = await searchPaksimDatabases(detectedCNIC);
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
    } else {
      console.log('⚠️ Primary API failed, trying Secondary...');
      initialRecords = await searchPaksimDatabases(queryForAPI);
      if (initialRecords.length > 0) {
        allRecords = initialRecords;
        
        const cnis = getAllCNICs(initialRecords);
        if (cnis.length > 0) {
          detectedCNIC = cnis[0];
          console.log(`📌 Found CNIC: ${detectedCNIC}`);
          
          const cnicRecords = await searchPaksimDatabases(detectedCNIC);
          if (cnicRecords.length > 0) {
            const existingNumbers = new Set(allRecords.map(r => r.Mobile));
            cnicRecords.forEach(record => {
              if (!existingNumbers.has(record.Mobile)) {
                allRecords.push(record);
                existingNumbers.add(record.Mobile);
              }
            });
          }
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
      query: isCNIC ? cleanInput : queryForAPI,
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
// 🔧 PARSER & HELPERS
// =============================================
function parsePaksimDatabasesHTML(html) {
  try {
    const results = [];
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;
    
    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableHTML = tableMatch[1];
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      let isHeader = true;
      
      while ((rowMatch = rowRegex.exec(tableHTML)) !== null) {
        if (isHeader) {
          isHeader = false;
          continue;
        }
        
        const cells = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          let content = cellMatch[1]
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (content) cells.push(content);
        }
        
        if (cells.length >= 3) {
          let name = 'N/A', cnic = 'N/A', mobile = 'N/A', address = 'N/A';
          
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell.match(/^[0-9]{13}$/)) cnic = cell;
            else if (cell.match(/^03[0-9]{9}$/)) mobile = cell;
            else if (cell.match(/[A-Za-z]/) && cell.length > 2 && !cell.match(/^[0-9]+$/)) {
              if (name === 'N/A') name = cell;
              else if (address === 'N/A') address = cell;
            }
          }
          
          if (name !== 'N/A' && mobile !== 'N/A') {
            results.push({
              Name: name.replace(/\s+/g, ' ').trim(),
              Cnic: cnic.replace(/\s+/g, ' ').trim(),
              Mobile: mobile.replace(/\s+/g, ' ').trim(),
              Address: address.replace(/\s+/g, ' ').trim() || 'No address'
            });
          }
        }
      }
    }
    
    if (results.length === 0) {
      return parseAlternative(html);
    }
    return results;
  } catch (error) {
    console.error('Parser error:', error);
    return [];
  }
}

function parseAlternative(html) {
  try {
    const results = [];
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                     .replace(/<style[\s\S]*?<\/style>/gi, '');
    const text = clean.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
    const cnicMatches = text.match(/\b([0-9]{13})\b/g) || [];
    const mobileMatches = text.match(/\b(03[0-9]{9})\b/g) || [];
    const nameMatches = text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g) || [];
    const addressMatches = text.match(/\b([A-Z][a-z]+ [0-9]+ [A-Za-z\s,]+)/g) || [];
    
    const maxLen = Math.max(cnicMatches.length, mobileMatches.length, nameMatches.length);
    
    for (let i = 0; i < maxLen; i++) {
      const name = nameMatches[i] || 'Unknown';
      const cnic = cnicMatches[i] || 'N/A';
      const mobile = mobileMatches[i] || 'N/A';
      const address = addressMatches[i] || 'No address';
      
      if (mobile !== 'N/A' && name !== 'Unknown') {
        results.push({
          Name: name.trim(),
          Cnic: cnic.trim(),
          Mobile: mobile.trim(),
          Address: address.trim()
        });
      }
    }
    return results;
  } catch (error) {
    console.error('Alternative parser error:', error);
    return [];
  }
}

function getSmartName(records) {
  const garbage = ['data not recieved from nadra', 'not received', 'no data', 'unknown', 'n/a', 'null', 'undefined', 'no', '-', 'cnic', 'mobile', 'address', 'search'];
  const names = records.map(r => r.Name).filter(n => n && n.trim().length > 0).map(n => n.trim());
  if (names.length === 0) return 'Unknown';
  
  const valid = names.filter(n => !garbage.some(g => n.toLowerCase().includes(g)));
  if (valid.length === 0) return names[0];
  
  const count = {};
  valid.forEach(n => count[n] = (count[n] || 0) + 1);
  return Object.keys(count).reduce((a, b) => count[a] > count[b] ? a : b);
}

function getSmartAddress(records) {
  const garbage = ['no', 'n/a', 'null', 'undefined', '-', 'na', 'no address'];
  let best = 'No address available';
  let maxLen = 0;
  
  records.forEach(r => {
    if (r.Address && r.Address.trim().length > 0) {
      const addr = r.Address.trim();
      if (!garbage.includes(addr.toLowerCase()) && addr.length > maxLen) {
        maxLen = addr.length;
        best = addr;
      }
    }
  });
  return best;
}

function getAllNumbers(records) {
  return [...new Set(records.map(r => r.Mobile).filter(n => n && n.trim().length > 0).map(n => n.trim()))];
}

function getAllCNICs(records) {
  return [...new Set(records.map(r => r.Cnic).filter(c => c && c.trim().length >= 13).map(c => c.trim()))];
    }
