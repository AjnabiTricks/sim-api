export default async function handler(req, res) {
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
      error: 'Please provide "search" parameter'
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
    console.log(`🔍 Searching for: ${phoneNumber}`);

    // =============================================
    // 📞 SEARCH FUNCTION with FALLBACK
    // =============================================
    async function searchData(query) {
      try {
        // Try paksim.info
        const response = await fetch('https://paksim.info/sim-database-online-2022-result.php', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
            'origin': 'https://paksim.info',
            'referer': 'https://paksim.info/search.php'
          },
          body: new URLSearchParams({ cnnum: query })
        });

        if (response.ok) {
          const html = await response.text();
          const data = parsePaksimHTML(html);
          if (data && data.length > 0) return data;
        }
      } catch (e) {
        console.log('Paksim failed:', e.message);
      }

      // FALLBACK: Try kingdb.xyz
      try {
        const response = await fetch(`https://kingdb.xyz/api.php?query=${query}`);
        const data = await response.json();
        if (data.status && data.data && data.data.data) {
          return data.data.data.map(item => ({
            Name: item.nam || 'Unknown',
            Cnic: item.cni || 'N/A',
            Mobile: item.nbr || query,
            Address: item.adr || 'No address'
          }));
        }
      } catch (e) {
        console.log('Kingdb failed:', e.message);
      }

      return [];
    }

    // =============================================
    // 🔍 SEARCH LOGIC
    // =============================================
    let allRecords = [];
    let detectedCNIC = null;

    if (isCNIC) {
      const records = await searchData(cleanInput);
      if (records.length > 0) {
        allRecords = records;
        detectedCNIC = cleanInput;
      }
    } else {
      // Search by phone
      const phoneRecords = await searchData(phoneNumber);
      if (phoneRecords.length > 0) {
        allRecords = phoneRecords;
        
        // Extract CNIC and search for all numbers
        const cnis = getAllCNICs(phoneRecords);
        if (cnis.length > 0) {
          detectedCNIC = cnis[0];
          console.log(`📌 Found CNIC: ${detectedCNIC}`);
          
          // Search by CNIC for all numbers
          const cnicRecords = await searchData(detectedCNIC);
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
        query: search,
        suggestion: 'Check if number is correct or try different network provider'
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

    // Smart filters (same as before)
    const finalName = getSmartName(uniqueData);
    const bestAddress = getSmartAddress(uniqueData);
    const allNumbers = getAllNumbers(uniqueData);
    const allCNICs = getAllCNICs(uniqueData);

    // Final response
    const finalResponse = {
      success: true,
      query: isCNIC ? cleanInput : phoneNumber,
      detectedType: isCNIC ? 'cnic' : 'phone',
      data: {
        name: finalName,
        allNumbers: allNumbers,
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
// 🔧 HELPER FUNCTIONS
// =============================================

function parsePaksimHTML(html) {
  try {
    const results = [];
    const tableStart = html.indexOf('<table');
    const tableEnd = html.indexOf('</table>', tableStart);
    
    if (tableStart === -1 || tableEnd === -1) return results;

    const tableHTML = html.substring(tableStart, tableEnd + 8);
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    
    let rowMatch;
    let isHeader = true;
    
    while ((rowMatch = rowRegex.exec(tableHTML)) !== null) {
      if (isHeader) { isHeader = false; continue; }
      
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        let content = cellMatch[1]
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        cells.push(content);
      }
      
      if (cells.length >= 4) {
        results.push({
          Name: cells[0] || 'N/A',
          Cnic: cells[1] || 'N/A',
          Mobile: cells[2] || 'N/A',
          Address: cells[3] || 'N/A'
        });
      }
    }
    return results;
  } catch (error) {
    console.error('Parse error:', error);
    return [];
  }
}

function getSmartName(records) {
  const garbage = ['data not recieved from nadra', 'data not received from nadra', 'not received', 'no data', 'unknown', 'n/a', 'null', 'undefined', 'no', '-'];
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
  const numbers = records.map(r => r.Mobile).filter(n => n && n.trim().length > 0).map(n => n.trim());
  return [...new Set(numbers)];
}

function getAllCNICs(records) {
  const cnis = records.map(r => r.Cnic).filter(c => c && c.trim().length > 0).map(c => c.trim());
  return [...new Set(cnis)];
            }
