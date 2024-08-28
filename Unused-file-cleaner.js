const fs = require('fs')
const path = require('path')

const autoDelete = true
const filesDir = path.resolve(__dirname, 'src/assets/BackOffice/images')
const srcDir = path.resolve(__dirname, 'src')
const unUsedExtensions = ["png","svg","jpg","jpeg"]
const searchInExtensions = ["js", "jsx", "css"]


const unusedFiles = []
const walkSync = (dir) => {
    fs.readdirSync(dir).forEach(file => {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)

        if (stat.isDirectory()) {
            walkSync(filePath)
        } else if (unUsedExtensions.includes(file.split('.').pop().toLowerCase())) {
            unusedFiles.push(filePath)
        }
    })
}
walkSync(filesDir)


const isUsed = (testFile) => {
    const fileName = path.basename(testFile)
    const files = []
    const walkSrc = (dir) => {
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file)
            const stat = fs.statSync(filePath)

            if (stat.isDirectory()) {
                walkSrc(filePath)
            } else if (searchInExtensions.includes(file.split('.').pop().toLowerCase())) {
                files.push(filePath)
            }
        })
    }
    walkSrc(srcDir)

    return files.some(file => {
        const content = fs.readFileSync(file, 'utf8')
        return content.includes(fileName)
    })
}

unusedFiles.forEach(file => {
    if (!isUsed(file)) {
        if (autoDelete) {
            console.log(`Deleted: ${file}`)
            fs.unlinkSync(file)
        } else {
            console.log(`Unused: ${file}`)
        }
    }
})
