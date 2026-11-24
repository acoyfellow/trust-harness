use std::mem::ManuallyDrop;

pub fn alloc_bytes(len: u32) -> u32 {
    let mut buffer = ManuallyDrop::new(Vec::<u8>::with_capacity(len as usize));
    buffer.as_mut_ptr() as usize as u32
}

pub fn dealloc_bytes(ptr: u32, len: u32) {
    if ptr == 0 || len == 0 {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr as usize as *mut u8, len as usize, len as usize);
    }
}

pub fn pack_output(bytes: Vec<u8>) -> u64 {
    let mut owned = bytes;
    owned.shrink_to_fit();
    let len = owned.len() as u32;
    let ptr = owned.as_mut_ptr() as usize as u32;
    std::mem::forget(owned);
    ((ptr as u64) << 32) | (len as u64)
}

pub fn run_json<F>(ptr: u32, len: u32, handler: F) -> u64
where
    F: FnOnce(&str) -> String,
{
    let slice = if ptr == 0 || len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr as usize as *const u8, len as usize) }
    };
    let output = match std::str::from_utf8(slice) {
        Ok(input) => handler(input),
        Err(_) => "{\"error\":\"invalid utf-8\"}".to_string(),
    };
    pack_output(output.into_bytes())
}

#[macro_export]
macro_rules! export_judge {
    ($handler:path) => {
        #[no_mangle]
        pub extern "C" fn alloc(len: u32) -> u32 {
            $crate::alloc_bytes(len)
        }

        #[no_mangle]
        pub extern "C" fn dealloc(ptr: u32, len: u32) {
            $crate::dealloc_bytes(ptr, len);
        }

        #[no_mangle]
        pub extern "C" fn eval(ptr: u32, len: u32) -> u64 {
            $crate::run_json(ptr, len, $handler)
        }
    };
}
