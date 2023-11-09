const yargs = require('yargs');

const argv = yargs
    .options(
        {
            'https': {
                description: 'Set https port',
                alias: 'h',
                type: 'number'
            },
            'http': {
                description: 'Set http port',
                type: 'number'
            },
            'mqtt': {
                description: 'Set mqtt port',
                alias: 'm',
                type: 'number'
            },
            'unsafe': {
                description: 'Set unsafe mqtt port and enable unsafe mode',
                alias: 'u',
                type: 'number'
            }
        }
    ).parse()

module.exports = argv