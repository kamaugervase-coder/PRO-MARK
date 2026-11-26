const crypto=require('node:crypto');
const bcrypt=require('bcryptjs');

async function resetPassword(pool,token,password,hashPassword=bcrypt.hash){
  const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const tokenRow=await client.query(
      'SELECT id,user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',
      [tokenHash]
    );
    if(!tokenRow.rows.length){
      await client.query('ROLLBACK');
      return false;
    }
    const passwordHash=await hashPassword(password,12);
    await client.query('UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1',[tokenRow.rows[0].user_id,passwordHash]);
    const consumed=await client.query(
      'UPDATE password_reset_tokens SET used_at=now() WHERE id=$1 AND used_at IS NULL RETURNING id',
      [tokenRow.rows[0].id]
    );
    if(!consumed.rowCount)throw new Error('Password reset token could not be consumed.');
    await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',[tokenRow.rows[0].user_id]);
    await client.query('COMMIT');
    return true;
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{
    client.release();
  }
}

module.exports={resetPassword};
