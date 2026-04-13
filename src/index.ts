import express from 'express'
import { log } from 'node:console'
import { createPage } from './controllers/pages/pageController.js'
import { restoreRoutes } from './../lib/caddy.js'

const app = express()

app.use(express.json())

app.get("/", async (req, res) => {
    return res.json({
        message: "hello"
    })
})

app.post('/create_page', createPage)

app.listen(3000, async () => {
    log("server started at 3000")
    await restoreRoutes()
})
