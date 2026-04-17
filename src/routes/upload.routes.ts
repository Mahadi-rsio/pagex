import { Router } from 'express'
import multer from 'multer'
import { mkdirSync } from 'fs'
import { authMiddleware } from '../middleware/auth.middleware.js'
import { uploadFileHandler, getUploadStatusHandler } from '../controllers/upload.controller.js'
import { TEMP_ZIPS_DIR, MAX_FILE_SIZE } from '../constants/index.js'

mkdirSync(TEMP_ZIPS_DIR, { recursive: true })

const upload = multer({
    dest: `${TEMP_ZIPS_DIR}/`,
    limits: { fileSize: MAX_FILE_SIZE }
})

const router = Router()

router.post('/:bucket', authMiddleware, upload.single('file'), uploadFileHandler)
router.get('/status/:jobId', getUploadStatusHandler)

export default router
