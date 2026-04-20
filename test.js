fetch("http://api.localhost/api/pages/create", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer eyJhbGciOiJFZERTQSIsImtpZCI6IjU2OGZlN2I2LTg4NmItNDlmNS05YmYxLWEyZTgwNmM2MWExNyJ9.eyJpYXQiOjE3NzYzOTU5NTYsIm5hbWUiOiJSc2lvIEV4IiwiZW1haWwiOiJyc2lvZXhAZ21haWwuY29tIiwiZW1haWxWZXJpZmllZCI6dHJ1ZSwiaW1hZ2UiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NJdWJpRDhLZ3hGN2tDeWRYMDVvMWZ2eWFxSXpkY183Vi1ubEM4b2tIaW9IbkthM1E9czk2LWMiLCJjcmVhdGVkQXQiOiIyMDI2LTA0LTE2VDIyOjQ0OjA2Ljk0MFoiLCJ1cGRhdGVkQXQiOiIyMDI2LTA0LTE2VDIyOjQ0OjA2Ljk0MFoiLCJpZCI6Ilk2RDJuZUZHRkpxbTdVenJpakVNa1RZclBZbXRwdW5iIiwic3ViIjoiWTZEMm5lRkdGSnFtN1V6cmlqRU1rVFlyUFltdHB1bmIiLCJleHAiOjE3NzcwMDA3NTYsImlzcyI6Imh0dHBzOi8vY2xvdWRpc3kudmVyY2VsLmFwcCIsImF1ZCI6Imh0dHBzOi8vY2xvdWRpc3kudmVyY2VsLmFwcCJ9.7izpUl0UC4lRa8hsQQI0I1GRkcGC-gD-aTlvzHQ41F2-YOu88mBp_O8EnEnXNdYfqPbD_rbQx3MUD-PEOaT4DA"
    },
    body: JSON.stringify({
        project_name: "hello",
        plan: "free",
        tenant_name: "mahadi",
    }),
})
    .then(res => res.json())
    .then(data => console.log(data))
    .catch(err => console.error(err));
