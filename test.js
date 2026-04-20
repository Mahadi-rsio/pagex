const API_BASE = "http://api.localhost/api";

// ⚠️ Put your token here manually
const TOKEN = "eyJhbGciOiJFZERTQSIsImtpZCI6IjU2OGZlN2I2LTg4NmItNDlmNS05YmYxLWEyZTgwNmM2MWExNyJ9.eyJpYXQiOjE3NzYzOTU5NTYsIm5hbWUiOiJSc2lvIEV4IiwiZW1haWwiOiJyc2lvZXhAZ21haWwuY29tIiwiZW1haWxWZXJpZmllZCI6dHJ1ZSwiaW1hZ2UiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NJdWJpRDhLZ3hGN2tDeWRYMDVvMWZ2eWFxSXpkY183Vi1ubEM4b2tIaW9IbkthM1E9czk2LWMiLCJjcmVhdGVkQXQiOiIyMDI2LTA0LTE2VDIyOjQ0OjA2Ljk0MFoiLCJ1cGRhdGVkQXQiOiIyMDI2LTA0LTE2VDIyOjQ0OjA2Ljk0MFoiLCJpZCI6Ilk2RDJuZUZHRkpxbTdVenJpakVNa1RZclBZbXRwdW5iIiwic3ViIjoiWTZEMm5lRkdGSnFtN1V6cmlqRU1rVFlyUFltdHB1bmIiLCJleHAiOjE3NzcwMDA3NTYsImlzcyI6Imh0dHBzOi8vY2xvdWRpc3kudmVyY2VsLmFwcCIsImF1ZCI6Imh0dHBzOi8vY2xvdWRpc3kudmVyY2VsLmFwcCJ9.7izpUl0UC4lRa8hsQQI0I1GRkcGC-gD-aTlvzHQ41F2-YOu88mBp_O8EnEnXNdYfqPbD_rbQx3MUD-PEOaT4DA";

/**
 * Core request handler
 */
async function apiRequest(endpoint, { method = "GET", body } = {}) {
    const data = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    })

    if (!data) {
        console.log("api fetch failed")
    }


    return data.json()
}

/**
 * Create page
 */
async function createPage(payload) {
    await apiRequest("/pages/create", {
        method: "POST",
        body: payload,
    });
}

/**
 * Get usage by domain
 */
async function getUsage(domain) {
    const data = await apiRequest(`/pages/usage/${domain}`, {
        method: "GET",
    });
    console.log(data)
}


async function m() {
    
	/**await createPage({
	    tenant_name : "mahadi",
	    plan : "free",
	    project_name: "hello"
    
	}) **/
    await getUsage("hello.localhost")

}

m()
