import crypto, { createDecipheriv } from 'crypto';
import { expect } from 'chai';
import sinon from 'sinon';

import cryptoPromise from '../../src/helpers/crypto.promise.js';
import encryptionHelper from '../../src/helpers/encryption.helper.js';
import env from '../../src/env/Env.js';

describe('helpers/encryption.helper.js', () => {
    const plainText = 'test plain text';
    const encryptedText = 'encrypted';
    const randomIv = 'test random iv';
    const encryptionKeys = 
    [
        {
            isPrimary: true,
            id: 0,
            value: 'testkey0'
        },
        {
            isPrimary: false,
            id: 1,
            value: 'testkey1'
        }
    ];
    const mockDecryptor = {
        update: () => '',
        final: () => ''
    };
    const mockCreateCipheriv = {
        update: () => '',
        final: () => ''
    };

    let mockEnv;

    beforeEach(() => {
        sinon.stub(crypto, 'createDecipheriv').returns(mockDecryptor);
        sinon.stub(crypto, 'createCipheriv').returns(mockCreateCipheriv);
        sinon.stub(cryptoPromise, 'randomBytes').resolves(randomIv);
    });

    describe('with invalid keys', () => {
        beforeEach(() => {
            const badKeys = [
                {
                    isPrimary: false,
                    id: 1,
                    value: 'testkey1'
                }
            ];
            mockEnv = {
                config: {
                    ENCRYPTION_KEYS: JSON.stringify(badKeys)
                }
            };
            sinon.stub(env, 'get').returns(mockEnv);
        });
    
        it('should detect an invalid primary key error and throw', () => {
            expect(() => encryptionHelper.encryptPromise('test plain text')).to.throw();
        });
    });

    describe('with valid encryption keys', () => {
        beforeEach(() => {
            mockEnv = {
                config: {
                    ENCRYPTION_KEYS: JSON.stringify(encryptionKeys)
                }
            };
            sinon.stub(env, 'get').returns(mockEnv);
        });

        it('should detect an invalid key error and throw', () => {
            const encryptedData = {
                keyId: 2,
                iv: 'test iv',
                data: 'test cipher text'
            };
            expect(() => encryptionHelper.decrypt(encryptedData)).to.throw();
        });
        
        it('should decrypt with the specified key and iv', () => {
            const encryptionKey = encryptionKeys.find(x => x.id === 1);
            const encryptedData = {
                keyId: encryptionKey.id,
                iv: 'test iv',
                data: 'test cipher data'
            };

            encryptionHelper.decrypt(encryptedData);

            expect(crypto.createDecipheriv).to.have.been.calledWith(
                'aes256',
                Buffer.from(encryptionKey.value, 'ascii'),
                Buffer.from(encryptedData.iv, 'ascii')
            );
        });
        
        it('should decrypt the ciphertext', () => {
            const encryptedData = {
                keyId: 1,
                iv: 'test iv',
                data: 'test cipher text'
            };

            sinon.stub(mockDecryptor, 'update').returns('');
            sinon.stub(mockDecryptor, 'final').returns(plainText);

            expect(encryptionHelper.decrypt(encryptedData)).to.eq(plainText);
        });
        
        it('should encrypt with the primary key with a random iv', async () => {
            const encryptionKey = encryptionKeys.find(x => x.isPrimary);

            sinon.stub(mockCreateCipheriv, 'update').returns('');
            sinon.stub(mockCreateCipheriv, 'final').returns('');
            
            await encryptionHelper.encryptPromise(plainText);
            expect(crypto.createCipheriv).to.have.been.calledWith(
                'aes256',
                Buffer.from(encryptionKey.value, 'ascii'),
                randomIv
            );
        });
        
        it('should attach the key id and IV to the encrypted data', async () => {
            sinon.stub(mockCreateCipheriv, 'update').returns('');
            sinon.stub(mockCreateCipheriv, 'final').returns('');

            await encryptionHelper.encryptPromise(plainText);
            expect(mockCreateCipheriv.update).to.have.been.calledWith(
                plainText,
                'utf8',
                'base64'
            );
        });

        it('should encrypt the data', async () => {
            const encryptionKey = encryptionKeys.find(x => x.isPrimary);
            sinon.stub(mockCreateCipheriv, 'update').returns('');
            sinon.stub(mockCreateCipheriv, 'final').returns(encryptedText);

            const res = await encryptionHelper.encryptPromise(plainText);
            expect(res).to.deep.equal({
                keyId: encryptionKey.id,
                iv: randomIv,
                ivEncoding: 'base64',
                data: encryptedText
            });
        });
    });

    describe('round trips with real crypto', () => {
        // 32 ascii chars -> a valid aes256 key
        const realKeys = [{ isPrimary: true, id: 0, value: '0123456789abcdef0123456789abcdef' }];

        beforeEach(() => {
            // drop the crypto stubs from the outer beforeEach: these tests
            // exercise the actual cipher to prove the encodings are lossless
            sinon.restore();
            sinon.stub(env, 'get').returns({
                config: { ENCRYPTION_KEYS: JSON.stringify(realKeys) }
            });
        });

        it('should round-trip when every IV byte has the high bit set', async () => {
            // 'ascii'-encoded IVs lost the high bit (the Node "bad decrypt" bug);
            // the base64 ivEncoding must survive the worst case
            sinon.stub(cryptoPromise, 'randomBytes').resolves(Buffer.alloc(16, 0xff));

            const encrypted = await encryptionHelper.encryptPromise(plainText);
            expect(encrypted.ivEncoding).to.eq('base64');
            expect(encryptionHelper.decrypt(encrypted)).to.eq(plainText);
        });

        it('should round-trip non-ascii (utf8) plaintext', async () => {
            const utf8Text = JSON.stringify({ username: '张伟', note: 'résumé' });
            const encrypted = await encryptionHelper.encryptPromise(utf8Text);
            expect(encryptionHelper.decrypt(encrypted)).to.eq(utf8Text);
        });

        it('should still decrypt legacy ciphertexts without ivEncoding', () => {
            // legacy format: 7-bit IV stored as 'ascii', plaintext encoded 'ascii'
            const iv = Buffer.from('abcdefghijklmnop', 'ascii');
            const key = Buffer.from(realKeys[0].value, 'ascii');
            const cipher = crypto.createCipheriv('aes256', key, iv);
            let data = cipher.update(plainText, 'ascii', 'base64');
            data += cipher.final('base64');
            const legacy = { keyId: 0, iv: iv.toString('ascii'), data };

            expect(encryptionHelper.decrypt(legacy)).to.eq(plainText);
        });
    });
});
