fetch("http://localhost:3000/create_page", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
    },
    body: JSON.stringify({
        project_name: "dev",
        plan: "free",
        tenant_name: "hade",
    }),
})
    .then(res => res.json())
    .then(data => console.log(data))
    .catch(err => console.error(err));
