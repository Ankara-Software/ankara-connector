//! Minimal ESC/POS encoder (ported from TypeScript escpos.ts).

pub struct PrintLine {
    pub text: String,
    pub bold: bool,
    pub align: Align,
    pub size: Size,
}

#[derive(Clone, Copy)]
pub enum Align {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy)]
pub enum Size {
    Normal,
    Double,
}

pub struct PrintJob {
    pub header: Option<String>,
    pub lines: Vec<PrintLine>,
    pub footer: Option<String>,
    pub cut: bool,
    pub code_page: u8,
}

const ESC: u8 = 0x1b;
const GS: u8 = 0x1d;
const LF: u8 = 0x0a;

pub fn encode_job(job: &PrintJob) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend([ESC, 0x40]);
    out.extend([ESC, 0x74, job.code_page]);

    let emit = |out: &mut Vec<u8>, line: &PrintLine| {
        let align = match line.align {
            Align::Left => 0,
            Align::Center => 1,
            Align::Right => 2,
        };
        out.extend([ESC, 0x61, align]);
        out.extend([ESC, 0x45, if line.bold { 1 } else { 0 }]);
        if matches!(line.size, Size::Double) {
            out.extend([GS, 0x21, 0x11]);
        } else {
            out.extend([GS, 0x21, 0x00]);
        }
        out.extend(line.text.as_bytes());
        out.push(LF);
        out.extend([ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0x00]);
    };

    if let Some(h) = &job.header {
        emit(
            &mut out,
            &PrintLine {
                text: h.clone(),
                bold: true,
                align: Align::Center,
                size: Size::Double,
            },
        );
    }
    for line in &job.lines {
        emit(&mut out, line);
    }
    if let Some(f) = &job.footer {
        emit(
            &mut out,
            &PrintLine {
                text: f.clone(),
                bold: false,
                align: Align::Center,
                size: Size::Normal,
            },
        );
    }

    if job.cut {
        out.extend([ESC, 0x64, 3, GS, 0x56, 0x42, 0x00]);
    }
    out
}

pub fn encode_drawer_kick() -> Vec<u8> {
    vec![ESC, 0x70, 1, 25, 25]
}
